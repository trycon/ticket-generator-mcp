// Auth0 access-token verification using the tenant JWKS (RS256).
// Verifies signature + issuer + audience + expiry. Never logs raw tokens.

import { createRemoteJWKSet, jwtVerify } from 'jose';

// Cache the remote JWKS per issuer so keys are fetched once and rotated by jose.
const jwksCache = new Map();

function getJwks(config) {
    let jwks = jwksCache.get(config.jwksUri);
    if (!jwks) {
        jwks = createRemoteJWKSet(new URL(config.jwksUri));
        jwksCache.set(config.jwksUri, jwks);
    }
    return jwks;
}

/**
 * Pulls a Bearer token out of an Authorization header. Returns null if absent/malformed.
 */
export function extractBearerToken(authHeader) {
    if (!authHeader || typeof authHeader !== 'string') return null;
    const match = authHeader.match(/^Bearer\s+(\S+)\s*$/i);
    return match ? match[1] : null;
}

/**
 * Cheap structural check for a JWT (three base64url segments). Used to distinguish an
 * Auth0 access token from a legacy raw TG API key so both can be supported at once.
 */
export function looksLikeJwt(token) {
    return typeof token === 'string' && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token);
}

// Normalise scopes from either the OAuth `scope` string or Auth0 `scp`/`permissions`.
function parseScope(payload) {
    if (typeof payload.scope === 'string') return payload.scope;
    if (Array.isArray(payload.scope)) return payload.scope.join(' ');
    if (typeof payload.scp === 'string') return payload.scp;
    if (Array.isArray(payload.scp)) return payload.scp.join(' ');
    return '';
}

// Email is not part of a default Auth0 access token; a tenant Action must add it
// (either as the standard `email` claim or a namespaced custom claim).
function parseEmail(payload) {
    return (
        payload.email ||
        payload['https://ticket-generator.com/email'] ||
        undefined
    );
}

/**
 * Verifies an Auth0 access token and returns the OAuth identity, or throws on failure.
 * @returns {Promise<{ sub: string, email?: string, scope: string, permissions?: string[] }>}
 */
export async function verifyAuth0Token(config, token) {
    const jwks = getJwks(config);
    const { payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: config.audience,
    });

    return {
        sub: payload.sub,
        email: parseEmail(payload),
        scope: parseScope(payload),
        permissions: Array.isArray(payload.permissions) ? payload.permissions : undefined,
    };
}

/**
 * Sends a 401 challenge with the RFC 9728 resource-metadata pointer.
 */
export function sendAuthChallenge(res, config, status, errorCode) {
    res.set('WWW-Authenticate', `Bearer resource_metadata="${config.protectedResourceUrl}"`);
    res.status(status).json({ error: errorCode });
}

/**
 * Express middleware that verifies the Bearer token and attaches `req.oauth`.
 * Exposed for reuse/testing; the /mcp session-init path composes the same logic.
 */
export function createVerifyAuth0TokenMiddleware(config) {
    return async (req, res, next) => {
        const token = extractBearerToken(req.headers['authorization']);
        if (!token) {
            return sendAuthChallenge(res, config, 401, 'missing_token');
        }
        try {
            req.oauth = await verifyAuth0Token(config, token);
            return next();
        } catch (_err) {
            // Do not log the token or verification internals.
            return sendAuthChallenge(res, config, 401, 'invalid_token');
        }
    };
}
