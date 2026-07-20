// Centralised Auth0 / MCP OAuth configuration, sourced from environment variables.
//
// Auth0 is the OAuth2/OIDC Authorization Server for MCP clients only. The MCP server
// validates Auth0 access tokens (RS256 via Auth0 JWKS), enforces scopes, and maps the
// token email to an existing TG user. Values are read from:
//   MCP_BASE_URL           - public MCP base URL (OAuth "resource" / audience)
//   AUTH0_ISSUER           - Auth0 tenant issuer (keeps its trailing slash)
//   AUTH0_AUDIENCE         - Auth0 API Identifier (access-token `aud`)
//   TG_MCP_INTERNAL_SECRET - shared secret for the TG internal lookup endpoint

function stripTrailingSlash(url) {
    return url && url.endsWith('/') ? url.slice(0, -1) : url;
}

function ensureTrailingSlash(url) {
    if (!url) return url;
    return url.endsWith('/') ? url : `${url}/`;
}

const MCP_OAUTH_SCOPES = ['all:read', 'all:write'];

/**
 * Returns true when the three required Auth0/MCP env vars are present.
 */
export function isAuthConfigured() {
    return Boolean(
        process.env.MCP_BASE_URL?.trim() &&
        process.env.AUTH0_ISSUER?.trim() &&
        process.env.AUTH0_AUDIENCE?.trim()
    );
}

/**
 * Builds the immutable Auth0/MCP config, or null when OAuth is not configured
 * (so the server can still run in legacy API-key mode for local development).
 */
export function loadAuthConfig() {
    if (!isAuthConfigured()) {
        return null;
    }

    const mcpBaseUrl = stripTrailingSlash(process.env.MCP_BASE_URL.trim());
    // Exact match to the Auth0 API Identifier (do not mutate - it is the token `aud`).
    const audience = process.env.AUTH0_AUDIENCE.trim();
    // Auth0's `iss` claim keeps a trailing slash; preserve it for exact verification.
    const issuer = ensureTrailingSlash(process.env.AUTH0_ISSUER.trim());
    const internalSecret = process.env.TG_MCP_INTERNAL_SECRET?.trim() || null;

    return {
        mcpBaseUrl,
        audience,
        issuer,
        internalSecret,
        scopes: MCP_OAUTH_SCOPES,
        jwksUri: `${issuer}.well-known/jwks.json`,
        openIdConfigurationUrl: `${issuer}.well-known/openid-configuration`,
        protectedResourceUrl: `${mcpBaseUrl}/.well-known/oauth-protected-resource`,
    };
}

export { MCP_OAUTH_SCOPES };
