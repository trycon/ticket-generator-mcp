// Orchestrates verify -> map -> mcp-access for the /mcp session-init request.
// MCP Streamable HTTP uses a custom POST /mcp handler (not an Express middleware
// chain), so this composes the same underlying helpers used by the middleware
// factories and returns the resolved context, or null after sending the response.

import { extractBearerToken, verifyAuth0Token, sendAuthChallenge } from './verifyAuth0Token.js';
import { resolveTgUser } from './tgUserMapping.js';

/**
 * @returns {Promise<null | {
 *   oauth: { sub: string, email?: string, scope: string, permissions?: string[] },
 *   tgUser: { id: string, email: string },
 *   apiKey: string,
 * }>}
 */
export async function authenticateMcpInit(config, tgLookupUrl, req, res) {
    // 1) Validate the Auth0 access token.
    const token = extractBearerToken(req.headers['authorization']);
    if (!token) {
        sendAuthChallenge(res, config, 401, 'missing_token');
        return null;
    }

    let oauth;
    try {
        oauth = await verifyAuth0Token(config, token);
    } catch (_err) {
        // Never log the token or verification internals.
        sendAuthChallenge(res, config, 401, 'invalid_token');
        return null;
    }

    // 2) Map the Auth0 email to a TG user.
    if (!oauth.email) {
        res.status(403).json({ error: 'tg_user_not_found' });
        return null;
    }

    let lookup;
    try {
        lookup = await resolveTgUser(config, tgLookupUrl, oauth.email);
    } catch (_err) {
        res.status(502).json({ error: 'tg_lookup_failed' });
        return null;
    }

    if (!lookup || !lookup.found) {
        res.status(403).json({ error: 'tg_user_not_found' });
        return null;
    }

    // 3) Confirm MCP access (the user has a TG API key).
    if (!lookup.hasMcpAccess || !lookup.apiKey) {
        res.status(403).json({ error: 'mcp_access_not_enabled' });
        return null;
    }

    return {
        oauth,
        tgUser: { id: lookup.userId, email: lookup.email },
        apiKey: lookup.apiKey,
    };
}
