// OAuth 2.0 discovery endpoints (RFC 9728 Protected Resource Metadata + AS metadata).
// These let MCP clients discover Auth0 as the Authorization Server for this resource.

import { Router } from 'express';

/**
 * Builds an Express router exposing the two well-known discovery endpoints.
 * @param {object} config - output of loadAuthConfig()
 */
export function createOAuthDiscoveryRouter(config) {
    const router = Router();

    // RFC 9728: describes this MCP server as a protected resource and points
    // clients at Auth0 as the authorization server.
    router.get('/.well-known/oauth-protected-resource', (_req, res) => {
        res.status(200).json({
            resource: config.mcpBaseUrl,
            authorization_servers: [config.issuer],
            scopes_supported: config.scopes,
            bearer_methods_supported: ['header'],
        });
    });

    // Redirect AS-metadata discovery to Auth0's OpenID configuration.
    router.get('/.well-known/oauth-authorization-server', (_req, res) => {
        res.redirect(302, config.openIdConfigurationUrl);
    });

    return router;
}
