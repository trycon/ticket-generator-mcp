// Maps an Auth0 identity to an existing Ticket Generator user by calling the TG
// internal lookup endpoint (shared-secret protected). Normal TG login is untouched:
// the endpoint just returns the user's existing TG API key, which the MCP then uses
// as `x-api-key` for downstream calls.

import axios from 'axios';

/**
 * Calls POST {tgLookupUrl} with { email } and the internal shared secret.
 * The API key is transported server-to-server over TLS and never logged.
 *
 * @returns {Promise<{
 *   found: boolean,
 *   reason?: 'tg_user_not_found',
 *   userId?: string,
 *   userUID?: string,
 *   email?: string,
 *   hasMcpAccess?: boolean,
 *   apiKey?: string,
 * }>}
 */
export async function resolveTgUser(config, tgLookupUrl, email) {
    const response = await axios.post(
        tgLookupUrl,
        { email },
        {
            headers: {
                'Content-Type': 'application/json',
                'x-tg-mcp-secret': config.internalSecret || '',
            },
            timeout: 10_000,
            // Interpret the body ourselves; don't throw on non-2xx.
            validateStatus: () => true,
        }
    );

    if (response.status === 403) {
        // Shared-secret rejected at the TG side - treat as a hard config error.
        const err = new Error('tg_internal_secret_rejected');
        err.code = 'tg_internal_secret_rejected';
        throw err;
    }

    const body = response.data;
    // Moleculer-web may wrap action results; unwrap common shapes defensively.
    if (body && typeof body === 'object') {
        if ('found' in body) return body;
        if (body.data && typeof body.data === 'object' && 'found' in body.data) {
            return body.data;
        }
    }
    return { found: false, reason: 'tg_user_not_found' };
}

/**
 * Express middleware: verifies the token email maps to a TG user, attaching
 * `req.tgUser` and `req._tgLookup`. Requires `req.oauth` to be set already.
 * Exposed for reuse/testing; the /mcp init path composes the same helpers.
 */
export function createMapAuth0ToTGUserMiddleware(config, tgLookupUrl) {
    return async (req, res, next) => {
        const email = req.oauth?.email;
        if (!email) {
            return res.status(403).json({ error: 'tg_user_not_found' });
        }
        let lookup;
        try {
            lookup = await resolveTgUser(config, tgLookupUrl, email);
        } catch (_err) {
            return res.status(502).json({ error: 'tg_lookup_failed' });
        }
        if (!lookup || !lookup.found) {
            return res.status(403).json({ error: 'tg_user_not_found' });
        }
        req._tgLookup = lookup;
        req.tgUser = { id: lookup.userId, email: lookup.email };
        return next();
    };
}

/**
 * Express middleware: confirms the mapped TG user has MCP access (an API key),
 * stashing it on `req.tgApiKey`. Requires `createMapAuth0ToTGUserMiddleware` first.
 */
export function createCheckMcpAccessMiddleware() {
    return (req, res, next) => {
        const lookup = req._tgLookup;
        if (!lookup || !lookup.hasMcpAccess || !lookup.apiKey) {
            return res.status(403).json({ error: 'mcp_access_not_enabled' });
        }
        req.tgApiKey = lookup.apiKey;
        return next();
    };
}
