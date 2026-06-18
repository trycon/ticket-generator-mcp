import { Router } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const MCP_OAUTH_SCOPES = ['all:read', 'all:write'];

/**
 * Ensures an issuer URL ends with a trailing slash so well-known paths can be appended.
 */
function ensureTrailingSlash(url) {
    return url.endsWith('/') ? url : `${url}/`;
}

/**
 * Removes a trailing slash from the MCP resource base URL.
 */
function stripTrailingSlash(url) {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Resolves the configured TG Authorization Server issuer.
 */
function getRawAuthServerIssuer() {
    return (
        process.env.AUTH_SERVER_ISSUER?.trim() || ''
    );
}

/**
 * Required scopes a presented access token must contain to access the MCP.
 * Configurable via OAUTH_REQUIRED_SCOPES (space-separated); defaults to all:read all:write.
 */
function getRequiredScopes() {
    const raw = process.env.OAUTH_REQUIRED_SCOPES?.trim();
    if (!raw) return MCP_OAUTH_SCOPES;
    return raw.split(/\s+/).filter(Boolean);
}

/**
 * Reads OAuth discovery settings from environment variables.
 * Returns null when MCP_BASE_URL or the AS issuer is not configured.
 */
export function loadOAuthDiscoveryConfig() {
    const rawMcpBaseUrl = process.env.MCP_BASE_URL?.trim();
    const rawAuthServerIssuer = getRawAuthServerIssuer();

    if (!rawMcpBaseUrl || !rawAuthServerIssuer) {
        return null;
    }

    let mcpBaseUrl;
    let authServerIssuer;

    try {
        mcpBaseUrl = stripTrailingSlash(new URL(rawMcpBaseUrl).href);
    } catch {
        throw new Error(`MCP_BASE_URL is not a valid URL: ${rawMcpBaseUrl}`);
    }

    try {
        // Issuer (no trailing slash) is what the AS puts in the `iss` claim.
        authServerIssuer = stripTrailingSlash(new URL(rawAuthServerIssuer).href);
    } catch {
        throw new Error(`AUTH_SERVER_ISSUER is not a valid URL: ${rawAuthServerIssuer}`);
    }

    const authServerMetadataUrl = new URL(
        '.well-known/openid-configuration',
        ensureTrailingSlash(authServerIssuer),
    ).href;

    const jwksUri = new URL(
        '.well-known/jwks.json',
        ensureTrailingSlash(authServerIssuer),
    ).href;

    return {
        mcpBaseUrl,
        authServerIssuer,
        authServerMetadataUrl,
        jwksUri,
        scopes: MCP_OAUTH_SCOPES,
        requiredScopes: getRequiredScopes(),
    };
}

/**
 * Returns true when both OAuth discovery environment variables are set.
 */
export function isOAuthDiscoveryConfigured() {
    return Boolean(process.env.MCP_BASE_URL?.trim() && getRawAuthServerIssuer());
}

/**
 * Public URL of the RFC 9728 Protected Resource Metadata document.
 *
 * RFC 9728 uses path-insertion: for a resource identifier that includes a path
 * (e.g. https://tools.ticket-generator.com/mcp) the metadata document lives at
 * `<origin>/.well-known/oauth-protected-resource<path>`
 * (-> https://tools.ticket-generator.com/.well-known/oauth-protected-resource/mcp),
 * NOT under the resource path itself.
 */
export function getProtectedResourceMetadataUrl(config) {
    const resourceUrl = new URL(config.mcpBaseUrl);
    const resourcePath = resourceUrl.pathname.replace(/\/$/, '');
    return `${resourceUrl.origin}/.well-known/oauth-protected-resource${resourcePath}`;
}

/**
 * WWW-Authenticate header value for MCP clients when a Bearer token is missing/invalid.
 * RFC 9728 Section 5.1 — points clients to the protected resource metadata document.
 */
export function buildWwwAuthenticateHeader(config, error) {
    const resourceMetadataUrl = getProtectedResourceMetadataUrl(config);
    const scope = config.scopes.join(' ');
    let header = `Bearer resource_metadata="${resourceMetadataUrl}", scope="${scope}"`;
    if (error) {
        header += `, error="${error}"`;
    }
    return header;
}

/**
 * Extracts the token from an Authorization: Bearer <token> header.
 * Returns null when the header is missing or not a Bearer token.
 */
export function extractBearerToken(authHeader) {
    if (!authHeader || typeof authHeader !== 'string') {
        return null;
    }

    const match = authHeader.match(/^Bearer\s+(\S+)\s*$/i);
    return match ? match[1] : null;
}

/**
 * Sends 401 Unauthorized with the MCP OAuth WWW-Authenticate challenge.
 */
export function sendUnauthorizedChallenge(res, config, error) {
    res.set('WWW-Authenticate', buildWwwAuthenticateHeader(config, error));
    res.status(401).json({
        jsonrpc: '2.0',
        error: {
            code: -32000,
            message: 'Unauthorized: valid Bearer access token required',
        },
        id: null,
    });
}

// Lazily-created, cached remote JWKS per issuer (jose caches/rotates keys internally).
const jwksCache = new Map();

function getRemoteJwks(config) {
    if (!jwksCache.has(config.jwksUri)) {
        jwksCache.set(config.jwksUri, createRemoteJWKSet(new URL(config.jwksUri)));
    }
    return jwksCache.get(config.jwksUri);
}

/**
 * Parse the `scope` claim (space-separated string) into an array.
 */
function parseTokenScopes(payload) {
    if (Array.isArray(payload.scope)) return payload.scope;
    if (typeof payload.scope === 'string') {
        return payload.scope.split(/\s+/).filter(Boolean);
    }
    if (typeof payload.scp === 'string') {
        return payload.scp.split(/\s+/).filter(Boolean);
    }
    if (Array.isArray(payload.scp)) return payload.scp;
    return [];
}

/**
 * Verify an access token against the TG AS JWKS, enforcing issuer, audience, and scopes.
 * @returns {Promise<object|null>} decoded payload on success, null on failure.
 */
export async function verifyAccessToken(token, config) {
    try {
        const jwks = getRemoteJwks(config);
        const { payload } = await jwtVerify(token, jwks, {
            issuer: config.authServerIssuer,
            audience: config.mcpBaseUrl,
        });

        const tokenScopes = parseTokenScopes(payload);
        const hasAllRequired = config.requiredScopes.every((s) => tokenScopes.includes(s));
        if (!hasAllRequired) {
            return null;
        }

        return payload;
    } catch {
        return null;
    }
}

/**
 * Express middleware for /mcp — validates the Bearer access token against the TG
 * Authorization Server (RS256 via JWKS, issuer/audience/scope checks) when OAuth
 * discovery is enabled. Existing sessions (mcp-session-id) are allowed through
 * because they were authenticated during initialization.
 */
export function createMcpOAuthMiddleware(config) {
    return async (req, res, next) => {
        const sessionId = req.headers['mcp-session-id'];

        if (sessionId) {
            return next();
        }

        const bearerToken = extractBearerToken(req.headers['authorization']);

        if (!bearerToken) {
            return sendUnauthorizedChallenge(res, config);
        }

        const payload = await verifyAccessToken(bearerToken, config);
        if (!payload) {
            return sendUnauthorizedChallenge(res, config, 'invalid_token');
        }

        // Expose validated identity to downstream handlers.
        req.oauth = { token: bearerToken, payload };
        return next();
    };
}

/**
 * RFC 9728 Protected Resource Metadata document for this MCP server.
 */
function buildProtectedResourceMetadata(config) {
    return {
        resource: config.mcpBaseUrl,
        authorization_servers: [config.authServerIssuer],
        scopes_supported: config.scopes,
        bearer_methods_supported: ['header'],
    };
}

/**
 * Express router for MCP OAuth discovery endpoints required by Claude, Cursor,
 * ChatGPT, Gemini, and other MCP clients.
 *
 * GET /.well-known/oauth-protected-resource
 *   Returns RFC 9728 metadata pointing clients to the TG authorization server.
 *
 * GET /.well-known/oauth-authorization-server
 *   Redirects (302) to the TG AS OpenID Connect discovery document.
 */
export function createOAuthDiscoveryRouter(config) {
    const router = Router();

    const sendMetadata = (_req, res) =>
        res.status(200).json(buildProtectedResourceMetadata(config));

    // Path-insertion form derived from the resource identifier (e.g. .../mcp).
    const metadataPath = new URL(getProtectedResourceMetadataUrl(config)).pathname;
    router.get(metadataPath, sendMetadata);

    // Also serve the bare root path for clients that omit the resource path suffix.
    if (metadataPath !== '/.well-known/oauth-protected-resource') {
        router.get('/.well-known/oauth-protected-resource', sendMetadata);
    }

    router.get('/.well-known/oauth-authorization-server', (_req, res) => {
        res.redirect(302, config.authServerMetadataUrl);
    });

    return router;
}
