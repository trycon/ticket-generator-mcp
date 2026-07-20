// Scope enforcement for MCP tools.
//
// MCP Streamable HTTP multiplexes every tool over a single POST /mcp, so per-tool
// scope cannot be enforced by HTTP middleware (which can't see the tool name).
// Instead each tool is statically classified read/write here and enforced inside
// the tool dispatch. `requireScope` is also exported as Express middleware for any
// conventional per-route use / testing.

export const SCOPE_READ = 'all:read';
export const SCOPE_WRITE = 'all:write';

// Static classification of every tool. Reads require all:read; any tool with a
// side effect (create/update/delete/generate/send) requires all:write.
export const TOOL_SCOPES = {
    // ----- reads (all:read) -----
    get_events_details: SCOPE_READ,
    list_events: SCOPE_READ,
    get_event: SCOPE_READ,
    get_event_summary: SCOPE_READ,
    list_attendees: SCOPE_READ,
    get_attendee: SCOPE_READ,
    get_check_in_log: SCOPE_READ,
    get_ticket_status: SCOPE_READ,
    get_event_analytics: SCOPE_READ,
    get_event_report: SCOPE_READ,
    get_account_analytics: SCOPE_READ,
    list_webhooks: SCOPE_READ,

    // ----- writes / side effects (all:write) -----
    get_ticket_data: SCOPE_WRITE,   // generates + persists a ticket
    get_ticket_url: SCOPE_WRITE,    // generates a ticket + URL
    send_ticket: SCOPE_WRITE,
    create_event: SCOPE_WRITE,
    update_event: SCOPE_WRITE,
    cancel_event: SCOPE_WRITE,
    update_attendee: SCOPE_WRITE,
    resend_ticket: SCOPE_WRITE,
    cancel_ticket: SCOPE_WRITE,
    create_webhook: SCOPE_WRITE,
    delete_webhook: SCOPE_WRITE,
};

/**
 * Collects granted scopes from `req.oauth.scope` (space-separated) and `permissions`.
 */
export function grantedScopes(oauth) {
    const set = new Set();
    if (!oauth) return set;
    String(oauth.scope || '')
        .split(/\s+/)
        .filter(Boolean)
        .forEach((s) => set.add(s));
    if (Array.isArray(oauth.permissions)) {
        oauth.permissions.forEach((p) => set.add(p));
    }
    return set;
}

/**
 * True when the OAuth identity carries the required scope.
 */
export function hasScope(oauth, required) {
    return grantedScopes(oauth).has(required);
}

/**
 * Returns the scope required for a tool. Unknown tools default to the stricter write scope.
 */
export function getRequiredScopeForTool(toolName) {
    return TOOL_SCOPES[toolName] || SCOPE_WRITE;
}

/**
 * Express middleware requiring a specific scope on `req.oauth`.
 */
export function requireScope(required) {
    return (req, res, next) => {
        if (!hasScope(req.oauth, required)) {
            return res.status(403).json({ error: 'insufficient_scope', requiredScope: required });
        }
        return next();
    };
}
