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


const TG_API_BASE_URL = 'https://apis.ticket-generator.com/client/v1';

// Store API keys by session ID for HTTP transport
const apiKeysBySession = {};

// Create MCP server instance (for stdio mode or as template)
function createServer(apiKey = null) {
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
        return await handleToolCall(name, args, apiKey);
    });

    return server;
}

// Helper function to make API requests to Ticket Generator
async function makeTGRequest(endpoint, method = 'GET', data = null, apiKey = null) {

    try {

        // console.log('Making API request to:', `${TG_API_BASE_URL}${endpoint}`);
        // console.log('API Key:', apiKey);
        // console.log('Data:', data);
        // console.log('Method:', method);

        const config = {
            method,
            url: `${TG_API_BASE_URL}${endpoint}`,
            headers: {
                'x-api-key': apiKey,
                'Content-Type': 'application/json',
            },
        };

        if (data && (method === 'POST' || method === 'PUT')) {
            config.data = data;
        }

        const response = await axios(config);

        // console.log('Response:', response.data);

        return {
            success: true,
            data: response.data,
            status: response.status,
        };

    } catch (error) {

        return {
            success: false,
            error: error.response?.data?.message || error.message,
            status: error.response?.status || 500,
        };

    }

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
        ];
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
                     return {
                         content: [
                             {
                                 type: 'text',
                                 text: `Ticket generated successfully!\n\nTicket Category Name: ${result.data.ticketCategoryName}\nTicket ID: ${result.data.ticketId}\Ticket Data (Base64): ${result.data.base64EncodedUrl}`,
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
            exposedHeaders: ['Mcp-Session-Id'],
            allowedHeaders: ['Content-Type', 'mcp-session-id'],
        }));

        // Rate limiting
        const windowMs = Number(process.env.RATE_WINDOW_MS || 60_000);
        const maxReq = Number(process.env.RATE_MAX || 60);
        app.use(rateLimit({ windowMs, max: maxReq, standardHeaders: true, legacyHeaders: false }));

        // Store transports and servers by session ID
        const transports = {};
        const servers = {};

        // Health check
        app.get('/health', (req, res) => {
            res.json({ status: 'ok', name: 'ticket-generator-mcp' });
        });

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
                    // New initialization request - extract API key from Authorization header
                    const apiKey = authHeader || null;
                    
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

                    // Create a new server instance with the API key for this session
                    const sessionServer = createServer(apiKey);
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
        const port = Number(process.env.PORT) || 3000;

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
