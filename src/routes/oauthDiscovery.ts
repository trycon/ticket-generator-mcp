import { Router, type Request, type Response } from 'express';
import type { AuthConfig, OAuthProtectedResourceMetadata } from '../types/oauth.js';

/**
 * Builds the RFC 9728 Protected Resource Metadata document for this MCP server.
 */
function buildProtectedResourceMetadata(config: AuthConfig): OAuthProtectedResourceMetadata {
  return {
    resource: config.mcpBaseUrl,
    authorization_servers: [config.auth0Issuer],
    scopes_supported: config.scopes,
    bearer_methods_supported: ['header'],
  };
}

/**
 * Creates an Express router exposing MCP OAuth discovery endpoints.
 *
 * Endpoints:
 * - GET /.well-known/oauth-protected-resource
 *   Returns RFC 9728 metadata so MCP clients (Claude, Cursor, ChatGPT, Gemini)
 *   can locate the authorization server and supported scopes.
 *
 * - GET /.well-known/oauth-authorization-server
 *   Redirects (302) to Auth0's OpenID Connect discovery document so clients
 *   that probe the MCP host for authorization-server metadata are forwarded
 *   to the canonical Auth0 issuer metadata.
 */
export function createOAuthDiscoveryRouter(config: AuthConfig): Router {
  const router = Router();

  router.get(
    '/.well-known/oauth-protected-resource',
    (_req: Request, res: Response): void => {
      const metadata = buildProtectedResourceMetadata(config);
      res.status(200).json(metadata);
    },
  );

  router.get(
    '/.well-known/oauth-authorization-server',
    (_req: Request, res: Response): void => {
      res.redirect(302, config.auth0OpenIdConfigurationUrl);
    },
  );

  return router;
}
