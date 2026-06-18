/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 * Served at `/.well-known/oauth-protected-resource` so MCP clients can discover
 * which authorization server protects this resource and which scopes are supported.
 */
export interface OAuthProtectedResourceMetadata {
  /** Canonical identifier of this MCP resource server (the MCP base URL). */
  resource: string;

  /** OAuth 2.0 authorization server issuer URLs that can issue tokens for this resource. */
  authorization_servers: readonly string[];

  /** OAuth scopes this resource server accepts on incoming access tokens. */
  scopes_supported: readonly string[];

  /** How bearer tokens may be presented; MCP uses the Authorization header. */
  bearer_methods_supported: readonly string[];
}

/** Supported MCP OAuth scopes for Ticket Generator. */
export type McpOAuthScope = 'read' | 'write';

/** Strongly typed runtime configuration for MCP OAuth discovery. */
export interface AuthConfig {
  /** Public base URL of this MCP server (no trailing slash). */
  mcpBaseUrl: string;

  /** Auth0 tenant issuer URL (normalized with trailing slash). */
  auth0Issuer: string;

  /** Auth0 OpenID Connect discovery document URL. */
  auth0OpenIdConfigurationUrl: string;

  /** OAuth scopes exposed to MCP clients during discovery. */
  scopes: readonly McpOAuthScope[];
}
