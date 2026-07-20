#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { loadAuthConfig } from './auth/authConfig.js';
import { createOAuthDiscoveryRouter } from './auth/discoveryRoutes.js';
import { getRequiredScopeForTool, hasScope } from './auth/scopes.js';
import { authenticateMcpInit } from './auth/authenticate.js';
import { extractBearerToken, looksLikeJwt } from './auth/verifyAuth0Token.js';


const TG_API_BASE_URL = 'https://apis.ticket-generator.com/client/v1';
// V2 client APIs share the same /client gateway prefix, mounted under /v2.
const TG_API_V2_BASE_URL = TG_API_BASE_URL.replace(/\/v1$/, '/v2');

// Store API keys by session ID for HTTP transport
const apiKeysBySession = {};

// Create MCP server instance (for stdio mode or as template).
// oauthContext (when Auth0 is enabled) carries the validated identity + scopes
// captured at session init, used to enforce per-tool scope during dispatch.
function createServer(apiKey = null, oauthContext = null) {
    const server = new Server(
        {
            name: 'ticket-generator-mcp',
            version: '1.0.0',
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );

    // List available tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: getToolDefinitions(),
        };
    });

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        // When Auth0 is enabled, enforce the tool's required scope here (the
        // Streamable HTTP transport multiplexes all tools over one POST /mcp,
        // so this is the only place that knows which tool is being invoked).
        if (oauthContext && oauthContext.oauth) {
            const requiredScope = getRequiredScopeForTool(name);
            if (!hasScope(oauthContext.oauth, requiredScope)) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ error: 'insufficient_scope', requiredScope }),
                        },
                    ],
                    isError: true,
                };
            }
        }

        return await handleToolCall(name, args, apiKey);
    });

    return server;
}

// Helper function to make API requests to Ticket Generator
// options: { baseUrl, params (query string object), headers (extra headers) }
async function makeTGRequest(endpoint, method = 'GET', data = null, apiKey = null, options = {}) {

    try {

        const baseUrl = options.baseUrl || TG_API_BASE_URL;

        const config = {
            method,
            url: `${baseUrl}${endpoint}`,
            headers: {
                'x-api-key': apiKey,
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
        };

        if (options.params) {
            config.params = options.params;
        }

        if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            config.data = data;
        }

        const response = await axios(config);

        return {
            success: true,
            data: response.data,
            status: response.status,
        };

    } catch (error) {

        return {
            // v2 errors use { error: { code, message, ... } }; v1 uses { message }
            success: false,
            error: error.response?.data?.error?.message ||
                error.response?.data?.message ||
                error.message,
            status: error.response?.status || 500,
        };

    }

}

// Helper for the V2 client APIs (cursor-paginated REST endpoints under /client/v2).
function makeTGV2Request(endpoint, method = 'GET', data = null, apiKey = null, options = {}) {
    return makeTGRequest(endpoint, method, data, apiKey, {
        ...options,
        baseUrl: TG_API_V2_BASE_URL,
    });
}

// Drops undefined/null/empty-string entries so we only forward provided fields.
function pickDefined(obj) {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined && value !== null && value !== '') {
            result[key] = value;
        }
    }
    return result;
}

// Shared tool definitions
function getToolDefinitions() {
    return [
            {
                name: 'get_ticket_data',
                description: 'Generates a ticket ID and its QR Code image (base64 PNG) for a given event. Optionally pass a ticket category and image width.',
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "eventId": {
                            "type": "string",
                            "description": "The Ticket Generator Event ID for which the ticket should be created"
                        },
                        "ticketCategoryId": {
                            "type": "string",
                            "description": "Optional Ticket Category ID. If the event has only one category, this can be omitted."
                        },
                        "width": {
                            "type": "integer",
                            "description": "QR image width/height in pixels (square). Allowed range: 300–1500. Default: 300.",
                            "minimum": 300,
                            "maximum": 1500,
                            "default": 300
                        }
                    },
                    "required": ["eventId", "width"]
                },
            },
            {
                name: 'get_ticket_url',
                description: 'Returns a URL to the rendered QR Code ticket for the specified event (and optional category). You can optionally override up to 5 variable fields on the ticket design.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        "eventId": {
                            "type": "string",
                            "description": "Ticket Generator Event ID (required)."
                        },
                        "ticketCategoryId": {
                            "type": "string",
                            "description": "Optional Ticket Category ID. Omit if the event has a single category."
                        },
                        "variables": {
                            "type": "array",
                            "description": "Optional list of variable fields to override on the ticket design (max 5). Leave header empty to use the default label defined in the design.",
                            "maxItems": 5,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "header": {
                                        "type": "string",
                                        "description": "Header/label for this variable (e.g., 'Name', 'Seat'). Optional."
                                    },
                                    "value": {
                                        "type": "string",
                                        "description": "Value for this variable (e.g., 'Mark', 'A2')."
                                    }
                                },
                                "required": ["value"],
                                "additionalProperties": false
                            }
                        }
                    },
                    required: ['eventId'],
                },
            },
            {
                name: 'send_ticket',
                description: 'Sends a generated ticket to a recipient via Email, SMS, or WhatsApp. You can include subject, body, and sender details, along with up to 5 custom variable fields.',
                inputSchema: {
                    "type": "object",
                    "properties": {
                        "eventId": {
                            "type": "string",
                            "description": "Ticket Generator Event ID (required)."
                        },
                        "ticketCategoryId": {
                            "type": "string",
                            "description": "Optional Ticket Category ID. Omit if the event has a single category."
                        },
                        "email": {
                            "type": "string",
                            "description": "Email address of the recipient (ticket will be sent here)."
                        },
                        "phoneNumber": {
                            "type": "string",
                            "description": "Recipient’s phone number for SMS delivery."
                        },
                        "whatsApp": {
                            "type": "boolean",
                            "description": "Set true to send ticket via WhatsApp (requires phoneNumber)."
                        },
                        "whatsAppConsent": {
                            "type": "boolean",
                            "description": "Whether the recipient has consented to receive WhatsApp messages (required if whatsApp is true)."
                        },
                        "subject": {
                            "type": "string",
                            "description": "Subject line of the email (if email is provided)."
                        },
                        "body": {
                            "type": "string",
                            "description": "Message body (HTML or plain text) for the email/SMS/WhatsApp message."
                        },
                        "fromName": {
                            "type": "string",
                            "description": "The sender name shown to the recipient."
                        },
                        "variables": {
                            "type": "array",
                            "description": "Optional list of up to 5 variable fields to personalize the ticket (header + value).",
                            "maxItems": 5,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "header": {
                                        "type": "string",
                                        "description": "Variable header label (e.g., 'Seat', 'Name'). Optional if default is set in design."
                                    },
                                    "value": {
                                        "type": "string",
                                        "description": "Value corresponding to the header (e.g., 'A12', 'Mark')."
                                    }
                                },
                                "required": ["value"]
                            }
                        }
                    },
                    "required": ["eventId"]
                },
            },
             {
                 name: 'get_events_details',
                 description: 'Return the details (name, description, start date, end date, location, ticket categories, etc.) of all active events associated with your account.',
                 inputSchema: {
                     type: 'object',
                     properties: {},
                     required: [],
                 },
             },
            // ----- V2 client APIs (events + attendees management) -----
            {
                name: 'list_events',
                description: 'V2: List your events with cursor pagination. Optionally filter by status and event start date range. Returns a page of events plus a next_cursor to fetch the following page.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        status: {
                            type: 'string',
                            description: 'Filter by event status.',
                            enum: ['active', 'cancelled', 'expired'],
                        },
                        date_from: {
                            type: 'string',
                            description: 'Only events whose start datetime is on/after this ISO 8601 datetime (e.g. 2026-01-01T00:00:00Z).',
                        },
                        date_to: {
                            type: 'string',
                            description: 'Only events whose start datetime is on/before this ISO 8601 datetime.',
                        },
                        cursor: {
                            type: 'string',
                            description: 'Opaque pagination cursor returned as next_cursor from a previous call. Omit for the first page.',
                        },
                        limit: {
                            type: 'integer',
                            description: 'Max number of events to return (1-100). Default server-side.',
                            minimum: 1,
                            maximum: 100,
                        },
                    },
                    required: [],
                },
            },
            {
                name: 'create_event',
                description: 'V2: Create a new event. Requires a name and an ISO 8601 start date (must be at least ~15 minutes in the future, UTC). Returns the created event details.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Event name (required).',
                        },
                        date: {
                            type: 'string',
                            description: 'Event start datetime in ISO 8601 (UTC), e.g. 2026-12-31T18:00:00Z (required).',
                        },
                        end_date: {
                            type: 'string',
                            description: 'Optional event end datetime in ISO 8601 (UTC). Defaults to end of the start day.',
                        },
                        venue: {
                            type: 'string',
                            description: "Optional venue. Defaults to 'To be announced'.",
                        },
                        description: {
                            type: 'string',
                            description: 'Optional event description.',
                        },
                    },
                    required: ['name', 'date'],
                },
            },
            {
                name: 'get_event',
                description: 'V2: Get the full details of a single event you own (works even for cancelled/expired events).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        eventId: {
                            type: 'string',
                            description: 'The event id (required).',
                        },
                    },
                    required: ['eventId'],
                },
            },
            {
                name: 'update_event',
                description: 'V2: Partially update an event (any of name, date, end_date, venue, description). Unchanged payloads are a safe no-op.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        eventId: {
                            type: 'string',
                            description: 'The event id to update (required).',
                        },
                        name: { type: 'string', description: 'New event name.' },
                        date: { type: 'string', description: 'New start datetime in ISO 8601 (UTC).' },
                        end_date: { type: 'string', description: 'New end datetime in ISO 8601 (UTC).' },
                        venue: { type: 'string', description: 'New venue.' },
                        description: { type: 'string', description: 'New description.' },
                    },
                    required: ['eventId'],
                },
            },
            {
                name: 'cancel_event',
                description: 'V2: Cancel an event (soft cancel; ticket records are preserved). Fails if any ticket for the event has already been scanned/checked in.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        eventId: {
                            type: 'string',
                            description: 'The event id to cancel (required).',
                        },
                    },
                    required: ['eventId'],
                },
            },
            {
                name: 'get_event_summary',
                description: 'V2: Get lightweight stats for an event: capacity, tickets issued/sent/cancelled, checked-in count and attendance rate.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        eventId: {
                            type: 'string',
                            description: 'The event id (required).',
                        },
                    },
                    required: ['eventId'],
                },
            },
            {
                name: 'list_attendees',
                description: "V2: List an event's attendees (tickets) with cursor pagination. Optionally search by name/email/phone and filter by delivery status. Returns a page plus next_cursor.",
                inputSchema: {
                    type: 'object',
                    properties: {
                        eventId: {
                            type: 'string',
                            description: 'The event id whose attendees to list (required).',
                        },
                        search: {
                            type: 'string',
                            description: 'Case-insensitive search across attendee name, email and phone.',
                        },
                        status: {
                            type: 'string',
                            description: 'Filter by ticket delivery status.',
                            enum: ['pending', 'sent', 'failed'],
                        },
                        cursor: {
                            type: 'string',
                            description: 'Opaque pagination cursor returned as next_cursor from a previous call.',
                        },
                        limit: {
                            type: 'integer',
                            description: 'Max number of attendees to return (1-100).',
                            minimum: 1,
                            maximum: 100,
                        },
                    },
                    required: ['eventId'],
                },
            },
            {
                name: 'get_attendee',
                description: 'V2: Get a single attendee/ticket detail including the live ticket URL, QR data and check-in state.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        eventId: {
                            type: 'string',
                            description: 'The event id (required).',
                        },
                        ticketId: {
                            type: 'string',
                            description: 'The ticket id of the attendee (required).',
                        },
                    },
                    required: ['eventId', 'ticketId'],
                },
            },
            {
                name: 'update_attendee',
                description: 'V2: Correct an attendee\'s details (any of name, email, phone). Data-only update; it does NOT resend the ticket. At least one field must be provided.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        eventId: {
                            type: 'string',
                            description: 'The event id (required).',
                        },
                        ticketId: {
                            type: 'string',
                            description: 'The ticket id of the attendee (required).',
                        },
                        name: { type: 'string', description: 'Corrected attendee name.' },
                        email: { type: 'string', description: 'Corrected email address.' },
                        phone: { type: 'string', description: 'Corrected phone number in E.164 format (e.g. +14155552671).' },
                    },
                    required: ['eventId', 'ticketId'],
                },
            },
            {
                name: 'resend_ticket',
                description: 'V2: Re-send an existing ticket to the attendee over a channel (email, sms or whatsapp). Does not create a new ticket or consume credits. The attendee must have a destination on file for the chosen channel.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        eventId: {
                            type: 'string',
                            description: 'The event id (required).',
                        },
                        ticketId: {
                            type: 'string',
                            description: 'The ticket id to resend (required).',
                        },
                        channel: {
                            type: 'string',
                            description: 'Delivery channel to resend on.',
                            enum: ['email', 'sms', 'whatsapp'],
                        },
                    },
                    required: ['eventId', 'ticketId', 'channel'],
                },
            },
            {
                name: 'cancel_ticket',
                description: 'V2: Cancel/invalidate a single attendee ticket for check-in. The ticket record is preserved. Fails if the ticket was already scanned/checked in.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        eventId: {
                            type: 'string',
                            description: 'The event id (required).',
                        },
                        ticketId: {
                            type: 'string',
                            description: 'The ticket id to cancel (required).',
                        },
                    },
                    required: ['eventId', 'ticketId'],
                },
            },
            // ----- V2 client APIs (Milestone 2: validation/check-in, analytics, webhooks) -----
            {
                name: 'get_check_in_log',
                description: "V2: List an event's check-ins (validated tickets) with cursor pagination, newest first. Optionally filter by check-in time range. Returns a page of {ticket_id, name, check_in_time, check_in_count, entry_point} plus next_cursor.",
                inputSchema: {
                    type: 'object',
                    properties: {
                        eventId: {
                            type: 'string',
                            description: 'The event id whose check-ins to list (required).',
                        },
                        date_from: {
                            type: 'string',
                            description: 'Only check-ins at/after this ISO 8601 datetime.',
                        },
                        date_to: {
                            type: 'string',
                            description: 'Only check-ins at/before this ISO 8601 datetime.',
                        },
                        cursor: {
                            type: 'string',
                            description: 'Opaque pagination cursor returned as next_cursor from a previous call.',
                        },
                        limit: {
                            type: 'integer',
                            description: 'Max number of check-ins to return (1-100).',
                            minimum: 1,
                            maximum: 100,
                        },
                    },
                    required: ['eventId'],
                },
            },
            {
                name: 'get_ticket_status',
                description: 'V2: Get the current validation status of a single ticket (valid, used, cancelled or expired) with its check-in count and last check-in time.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        eventId: {
                            type: 'string',
                            description: 'The event id (required).',
                        },
                        ticketId: {
                            type: 'string',
                            description: 'The ticket id to look up (required).',
                        },
                    },
                    required: ['eventId', 'ticketId'],
                },
            },
            {
                name: 'get_event_analytics',
                description: 'V2: Get structured analytics for an event: attendance_rate and delivery_rate (decimals), delivery_by_channel (email/sms/whatsapp), hourly check_in_timeline and failed_deliveries_count.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        eventId: {
                            type: 'string',
                            description: 'The event id (required).',
                        },
                    },
                    required: ['eventId'],
                },
            },
            {
                name: 'get_event_report',
                description: 'V2: Get a full per-attendee report for an event with delivery + check-in data. Returns JSON by default, or a CSV document when format is "csv".',
                inputSchema: {
                    type: 'object',
                    properties: {
                        eventId: {
                            type: 'string',
                            description: 'The event id (required).',
                        },
                        format: {
                            type: 'string',
                            description: 'Report format. "json" (default) returns structured data; "csv" returns a downloadable CSV document.',
                            enum: ['json', 'csv'],
                        },
                    },
                    required: ['eventId'],
                },
            },
            {
                name: 'get_account_analytics',
                description: 'V2: Get cross-event analytics for your account: total_events, total_tickets, avg_attendance_rate, tickets_by_channel and a per-event attendance_rate list. Optionally filter by event start date range and group_by week/month.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        date_from: {
                            type: 'string',
                            description: 'Only include events whose start datetime is on/after this ISO 8601 datetime.',
                        },
                        date_to: {
                            type: 'string',
                            description: 'Only include events whose start datetime is on/before this ISO 8601 datetime.',
                        },
                        group_by: {
                            type: 'string',
                            description: 'Optional grouping granularity for the summary.',
                            enum: ['week', 'month'],
                        },
                    },
                    required: [],
                },
            },
            {
                name: 'create_webhook',
                description: 'V2: Register a webhook endpoint to receive signed event notifications. Provide a https URL and one or more event types. A signing secret is returned ONCE in the response (store it to verify the X-TG-Signature HMAC-SHA256 header).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string',
                            description: 'The https endpoint that will receive POST notifications (required).',
                        },
                        events: {
                            type: 'array',
                            description: 'Event types to subscribe to (at least one required).',
                            minItems: 1,
                            items: {
                                type: 'string',
                                enum: [
                                    'ticket.created',
                                    'ticket.sent',
                                    'ticket.failed',
                                    'ticket.scanned',
                                    'ticket.cancelled',
                                    'event.created',
                                    'event.capacity_reached',
                                ],
                            },
                        },
                        secret: {
                            type: 'string',
                            description: 'Optional signing secret (8-256 chars). If omitted, one is generated and returned once.',
                        },
                    },
                    required: ['url', 'events'],
                },
            },
            {
                name: 'list_webhooks',
                description: 'V2: List your account\'s active webhook registrations (signing secrets are never returned).',
                inputSchema: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
            },
            {
                name: 'delete_webhook',
                description: 'V2: Delete (deactivate) a webhook registration so it stops receiving deliveries.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        webhookId: {
                            type: 'string',
                            description: 'The id of the webhook to delete (required).',
                        },
                    },
                    required: ['webhookId'],
                },
            },
        ];
}

// Renders a V2 tool result (structured JSON) into MCP content.
function buildV2ToolResult(result, successHeading, failureHeading) {
    if (result.success) {
        return {
            content: [
                {
                    type: 'text',
                    text: `${successHeading}\n\n${JSON.stringify(result.data, null, 2)}`,
                },
            ],
        };
    }
    return {
        content: [
            {
                type: 'text',
                text: `${failureHeading}: ${result.error}`,
            },
        ],
        isError: true,
    };
}

// Shared tool handler
async function handleToolCall(name, args, apiKey) {

    try {
        switch (name) {
             case 'get_ticket_data': {

                 const { eventId, ticketCategoryId, width = 300 } = args;
               
                 const requestData = { eventId, width };
               
                 if (ticketCategoryId) requestData.ticketCategoryId = ticketCategoryId;

                 const result = await makeTGRequest('/ticket/data', 'POST', requestData, apiKey);

                 if (result.success) {
                     // The QR is returned as a data URI. Emit it as a proper MCP image
                     // content block instead of inlining the base64 into text: large
                     // base64 strings in a text field get truncated by the tool-result
                     // size cap before reaching the model, corrupting the image.
                     const dataUri = result.data.base64EncodedUrl || '';
                     const dataUriMatch = /^data:(.+?);base64,(.*)$/s.exec(dataUri);
                     const mimeType = dataUriMatch ? dataUriMatch[1] : 'image/png';
                     const base64Data = dataUriMatch ? dataUriMatch[2] : dataUri.replace(/^data:[^,]*,/, '');

                     return {
                         content: [
                             {
                                 type: 'text',
                                 text: `Ticket generated successfully!\n\nTicket Category Name: ${result.data.ticketCategoryName}\nTicket ID: ${result.data.ticketId}`,
                             },
                             {
                                 type: 'image',
                                 data: base64Data,
                                 mimeType,
                             },
                         ],
                     };
                 } else {
                     return {
                         content: [
                             {
                                 type: 'text',
                                 text: `Failed to generate ticket: ${result.error}`,
                             },
                         ],
                         isError: true,
                     };
                 }
             }

             case 'get_ticket_url': {
              
                const { eventId, ticketCategoryId, variables } = args;
              
                const requestData = { eventId };
              
                if (ticketCategoryId) requestData.ticketCategoryId = ticketCategoryId;
                if (variables) requestData.variables = variables;

                 const result = await makeTGRequest('/ticket/url', 'POST', requestData, apiKey);

                 if (result.success) {
                     return {
                         content: [
                             {
                                 type: 'text',
                                 text: `Ticket URL generated successfully!\n\nURL: ${result.data}`,
                             },
                         ],
                     };
                 } else {
                     return {
                         content: [
                             {
                                 type: 'text',
                                 text: `Failed to get ticket URL: ${result.error}`,
                             },
                         ],
                         isError: true,
                     };
                 }
             }

             case 'send_ticket': {
                 
                const { eventId, ticketCategoryId, email, phoneNumber, whatsApp, whatsAppConsent, subject, body, fromName, variables } = args;
                
                const requestData = { eventId };
                
                if (ticketCategoryId) requestData.ticketCategoryId = ticketCategoryId;
                 if (email) requestData.email = email;
                 if (phoneNumber) requestData.phoneNumber = phoneNumber;
                 if (whatsApp) requestData.whatsApp = whatsApp;
                 if (whatsAppConsent) requestData.whatsAppConsent = whatsAppConsent;
                 if (subject) requestData.subject = subject;
                 if (body) requestData.body = body;
                 if (fromName) requestData.fromName = fromName;
                 if (variables) requestData.variables = variables;

                 const result = await makeTGRequest('/ticket/send', 'POST', requestData, apiKey);

                 if (result.success) {
                     return {
                         content: [
                             {
                                 type: 'text',
                                 text: `${result.data.message}.\nTicket ID: ${result.data.ticketId}`,
                             },
                         ],
                     };
                 } else {
                     return {
                         content: [
                             {
                                 type: 'text',
                                 text: `Failed to send ticket: ${result.error}`,
                             },
                         ],
                         isError: true,
                     };
                 }
             }

             case 'get_events_details': {
                 const result = await makeTGRequest('/event/details', 'GET', null, apiKey);

                 if (result.success) {
                     return {
                         content: [
                             {
                                 type: 'text',
                                 text: `Event details retrieved successfully!\n\nEvents:\n${JSON.stringify(result.data, null, 2)}`,
                             },
                         ],
                     };
                 } else {
                     return {
                         content: [
                             {
                                 type: 'text',
                                 text: `Failed to get event details: ${result.error}`,
                             },
                         ],
                         isError: true,
                     };
                 }
             }

            // ----- V2 client APIs -----
            case 'list_events': {

                const params = pickDefined({
                    status: args.status,
                    date_from: args.date_from,
                    date_to: args.date_to,
                    cursor: args.cursor,
                    limit: args.limit,
                });

                const result = await makeTGV2Request('/events', 'GET', null, apiKey, { params });

                return buildV2ToolResult(result, 'Events retrieved successfully!', 'Failed to list events');
            }

            case 'create_event': {

                const requestData = pickDefined({
                    name: args.name,
                    date: args.date,
                    end_date: args.end_date,
                    venue: args.venue,
                    description: args.description,
                });

                const result = await makeTGV2Request('/events', 'POST', requestData, apiKey, {
                    headers: { 'Idempotency-Key': randomUUID() },
                });

                return buildV2ToolResult(result, 'Event created successfully!', 'Failed to create event');
            }

            case 'get_event': {

                const result = await makeTGV2Request(`/events/${encodeURIComponent(args.eventId)}`, 'GET', null, apiKey);

                return buildV2ToolResult(result, 'Event retrieved successfully!', 'Failed to get event');
            }

            case 'update_event': {

                const requestData = pickDefined({
                    name: args.name,
                    date: args.date,
                    end_date: args.end_date,
                    venue: args.venue,
                    description: args.description,
                });

                const result = await makeTGV2Request(`/events/${encodeURIComponent(args.eventId)}`, 'PATCH', requestData, apiKey, {
                    headers: { 'Idempotency-Key': randomUUID() },
                });

                return buildV2ToolResult(result, 'Event updated successfully!', 'Failed to update event');
            }

            case 'cancel_event': {

                const result = await makeTGV2Request(`/events/${encodeURIComponent(args.eventId)}`, 'DELETE', null, apiKey);

                return buildV2ToolResult(result, 'Event cancelled successfully!', 'Failed to cancel event');
            }

            case 'get_event_summary': {

                const result = await makeTGV2Request(`/events/${encodeURIComponent(args.eventId)}/summary`, 'GET', null, apiKey);

                return buildV2ToolResult(result, 'Event summary retrieved successfully!', 'Failed to get event summary');
            }

            case 'list_attendees': {

                const params = pickDefined({
                    search: args.search,
                    status: args.status,
                    cursor: args.cursor,
                    limit: args.limit,
                });

                const result = await makeTGV2Request(`/events/${encodeURIComponent(args.eventId)}/attendees`, 'GET', null, apiKey, { params });

                return buildV2ToolResult(result, 'Attendees retrieved successfully!', 'Failed to list attendees');
            }

            case 'get_attendee': {

                const result = await makeTGV2Request(
                    `/events/${encodeURIComponent(args.eventId)}/attendees/${encodeURIComponent(args.ticketId)}`,
                    'GET',
                    null,
                    apiKey
                );

                return buildV2ToolResult(result, 'Attendee retrieved successfully!', 'Failed to get attendee');
            }

            case 'update_attendee': {

                const requestData = pickDefined({
                    name: args.name,
                    email: args.email,
                    phone: args.phone,
                });

                const result = await makeTGV2Request(
                    `/events/${encodeURIComponent(args.eventId)}/attendees/${encodeURIComponent(args.ticketId)}`,
                    'PATCH',
                    requestData,
                    apiKey,
                    { headers: { 'Idempotency-Key': randomUUID() } }
                );

                return buildV2ToolResult(result, 'Attendee updated successfully!', 'Failed to update attendee');
            }

            case 'resend_ticket': {

                const requestData = pickDefined({
                    channel: args.channel,
                });

                const result = await makeTGV2Request(
                    `/events/${encodeURIComponent(args.eventId)}/attendees/${encodeURIComponent(args.ticketId)}/resend`,
                    'POST',
                    requestData,
                    apiKey,
                    { headers: { 'Idempotency-Key': randomUUID() } }
                );

                return buildV2ToolResult(result, 'Ticket resend queued successfully!', 'Failed to resend ticket');
            }

            case 'cancel_ticket': {

                const result = await makeTGV2Request(
                    `/events/${encodeURIComponent(args.eventId)}/attendees/${encodeURIComponent(args.ticketId)}`,
                    'DELETE',
                    null,
                    apiKey
                );

                return buildV2ToolResult(result, 'Ticket cancelled successfully!', 'Failed to cancel ticket');
            }

            // ----- V2 client APIs (Milestone 2) -----
            case 'get_check_in_log': {

                const params = pickDefined({
                    date_from: args.date_from,
                    date_to: args.date_to,
                    cursor: args.cursor,
                    limit: args.limit,
                });

                const result = await makeTGV2Request(
                    `/events/${encodeURIComponent(args.eventId)}/checkins`,
                    'GET',
                    null,
                    apiKey,
                    { params }
                );

                return buildV2ToolResult(result, 'Check-in log retrieved successfully!', 'Failed to get check-in log');
            }

            case 'get_ticket_status': {

                const result = await makeTGV2Request(
                    `/events/${encodeURIComponent(args.eventId)}/tickets/${encodeURIComponent(args.ticketId)}/status`,
                    'GET',
                    null,
                    apiKey
                );

                return buildV2ToolResult(result, 'Ticket status retrieved successfully!', 'Failed to get ticket status');
            }

            case 'get_event_analytics': {

                const result = await makeTGV2Request(
                    `/events/${encodeURIComponent(args.eventId)}/analytics`,
                    'GET',
                    null,
                    apiKey
                );

                return buildV2ToolResult(result, 'Event analytics retrieved successfully!', 'Failed to get event analytics');
            }

            case 'get_event_report': {

                const params = pickDefined({
                    format: args.format,
                });

                const result = await makeTGV2Request(
                    `/events/${encodeURIComponent(args.eventId)}/report`,
                    'GET',
                    null,
                    apiKey,
                    { params }
                );

                // a CSV report comes back as a raw string; present it verbatim
                if (result.success && args.format === 'csv') {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Event report (CSV) generated successfully!\n\n${typeof result.data === 'string' ? result.data : JSON.stringify(result.data)}`,
                            },
                        ],
                    };
                }

                return buildV2ToolResult(result, 'Event report generated successfully!', 'Failed to generate event report');
            }

            case 'get_account_analytics': {

                const params = pickDefined({
                    date_from: args.date_from,
                    date_to: args.date_to,
                    group_by: args.group_by,
                });

                const result = await makeTGV2Request('/account/analytics', 'GET', null, apiKey, { params });

                return buildV2ToolResult(result, 'Account analytics retrieved successfully!', 'Failed to get account analytics');
            }

            case 'create_webhook': {

                const requestData = pickDefined({
                    url: args.url,
                    events: args.events,
                    secret: args.secret,
                });

                const result = await makeTGV2Request('/webhooks', 'POST', requestData, apiKey, {
                    headers: { 'Idempotency-Key': randomUUID() },
                });

                return buildV2ToolResult(result, 'Webhook registered successfully! Store the returned secret; it will not be shown again.', 'Failed to register webhook');
            }

            case 'list_webhooks': {

                const result = await makeTGV2Request('/webhooks', 'GET', null, apiKey);

                return buildV2ToolResult(result, 'Webhooks retrieved successfully!', 'Failed to list webhooks');
            }

            case 'delete_webhook': {

                const result = await makeTGV2Request(`/webhooks/${encodeURIComponent(args.webhookId)}`, 'DELETE', null, apiKey);

                return buildV2ToolResult(result, 'Webhook deleted successfully!', 'Failed to delete webhook');
            }

            default:
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Unknown tool: ${name}`,
                        },
                    ],
                    isError: true,
                };
        }
    } catch (error) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Error executing tool ${name}: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
}


// Start the server (stdio or http)
async function main() {
    const transportMode = process.env.MCP_TRANSPORT || 'stdio';

    if (transportMode === 'http') {
        const app = express();
        const jsonLimit = process.env.JSON_LIMIT || '200kb';
        app.use(express.json({ limit: jsonLimit }));

        // Security & prod middlewares
        app.use(helmet());
        app.use(compression());

        // Logging
        const logFormat = process.env.LOG_FORMAT || 'combined';
        app.use(morgan(logFormat));

        // CORS configuration for MCP
        const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
        app.use(cors({
            origin: corsOrigins.length ? corsOrigins : '*',
            exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate'],
            allowedHeaders: ['Content-Type', 'mcp-session-id', 'Authorization'],
        }));

        // Rate limiting
        const windowMs = Number(process.env.RATE_WINDOW_MS || 60_000);
        const maxReq = Number(process.env.RATE_MAX || 60);
        app.use(rateLimit({ windowMs, max: maxReq, standardHeaders: true, legacyHeaders: false }));

        // Auth0 OAuth (MCP clients only). When configured, mount discovery endpoints
        // and protect /mcp; otherwise fall back to legacy API-key-in-Authorization mode.
        const authConfig = loadAuthConfig();
        const tgLookupUrl = `${TG_API_BASE_URL}/internal/mcp-user-lookup`;
        if (authConfig) {
            app.use(createOAuthDiscoveryRouter(authConfig));
            console.error('Auth0 OAuth enabled for MCP (issuer:', authConfig.issuer, ')');
        } else {
            console.error('Auth0 OAuth disabled - set MCP_BASE_URL, AUTH0_ISSUER, AUTH0_AUDIENCE to enable');
        }

        // Store transports and servers by session ID
        const transports = {};
        const servers = {};

        // Health check
        app.get('/health', (req, res) => {
            res.json({ status: 'ok', name: 'ticket-generator-mcp' });
        });

        // // Dummy debug endpoint — logs query params only
        // app.all('/', (req, res) => {
        //     console.error('Request params:', req.query);
        //     res.json({ params: req.query });
        // });

        // MCP Streamable HTTP endpoint - handles POST, GET, DELETE
        app.all('/mcp', async (req, res) => {
            try {
                const sessionId = req.headers['mcp-session-id'];
                const authHeader = req.headers['authorization'];
                let transport;

                if (sessionId && transports[sessionId]) {
                    // Reuse existing transport
                    transport = transports[sessionId];
                } else if (!sessionId && req.method === 'POST') {
                    // New session. Resolve the downstream TG API key + OAuth context.
                    let apiKey;
                    let oauthContext = null;

                    // Only take the Auth0 path when a JWT Bearer token is presented. A raw
                    // TG API key (with or without a "Bearer " prefix) is treated as legacy,
                    // so both auth modes work simultaneously even when Auth0 is configured.
                    const bearer = extractBearerToken(authHeader);
                    const useAuth0 = Boolean(authConfig) && bearer && looksLikeJwt(bearer);

                    if (useAuth0) {
                        // Validate the Auth0 token, map email -> TG user, confirm MCP
                        // access, and use that user's existing TG API key downstream.
                        const authResult = await authenticateMcpInit(authConfig, tgLookupUrl, req, res);
                        if (!authResult) {
                            // authenticateMcpInit already sent the error response.
                            return;
                        }
                        apiKey = authResult.apiKey;
                        oauthContext = { oauth: authResult.oauth, tgUser: authResult.tgUser };
                    } else {
                        // Legacy API-key mode (backward compatible): the TG API key is
                        // provided via the x-api-key header or directly in Authorization.
                        apiKey = req.headers['x-api-key'] || bearer || authHeader || null;
                        console.log("apiKey", apiKey);
                    }

                    transport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: () => randomUUID(),
                        onsessioninitialized: (newSessionId) => {
                            transports[newSessionId] = transport;
                            apiKeysBySession[newSessionId] = apiKey;
                        },
                    });

                    // Clean up transport when closed
                    transport.onclose = () => {
                        if (transport.sessionId) {
                            delete transports[transport.sessionId];
                            delete apiKeysBySession[transport.sessionId];
                            delete servers[transport.sessionId];
                        }
                    };

                    // Create a new server instance with the API key + OAuth context for this session
                    const sessionServer = createServer(apiKey, oauthContext);
                    await sessionServer.connect(transport);
                    
                    // Store server instance
                    if (transport.sessionId) {
                        servers[transport.sessionId] = sessionServer;
                    }
                } else {
                    // Invalid request
                    return res.status(400).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32000,
                            message: 'Bad Request: No valid session ID provided',
                        },
                        id: null,
                    });
                }

                // Handle the request through the transport
                await transport.handleRequest(req, res, req.body);
            } catch (err) {
                console.error('Error handling MCP request:', err);
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32603,
                            message: 'Internal server error',
                        },
                        id: null,
                    });
                }
            }
        });

        const host = process.env.HOST || '0.0.0.0';
        const port = Number(process.env.PORT) || 3050;

        const httpServer = app.listen(port, host, () => {
            console.error(`Ticket Generator MCP server running on http://${host}:${port}`);
            console.error(`MCP endpoint: http://${host}:${port}/mcp`);
        });

        // Graceful shutdown
        const shutdown = () => {
            console.error('Shutting down...');
            httpServer.close(() => {
                process.exit(0);
            });
            setTimeout(() => process.exit(1), 10_000).unref();
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
        return;
    }

    // For stdio mode, try to get API key from environment variable (optional)
    const apiKey = process.env.TG_API_KEY || null;
    const server = createServer(apiKey);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Ticket Generator MCP server running on stdio');
}

main().catch((error) => {
    console.error('Fatal error in main():', error);
    process.exit(1);
});
