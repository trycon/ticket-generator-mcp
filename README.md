# Ticket Generator MCP Server

A Model Context Protocol (MCP) server that provides AI agents with access to the Ticket Generator APIs for managing tickets and events.

## Overview

This MCP server acts as a bridge between AI agents and the Ticket Generator APIs, allowing AI assistants to:
- Get ticket data and information
- Generate ticket URLs for sharing
- Send tickets via email or other delivery methods
- Retrieve event details and information

## Prerequisites

- Node.js 18.0.0 or higher
- A Ticket Generator API key (obtain from [https://apis.ticket-generator.com/client/api-docs/](https://apis.ticket-generator.com/client/api-docs/))

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your Ticket Generator API key:
   ```
   TG_API_KEY=your_actual_api_key_here
   ```

## Usage

### Running the MCP Server

Start the server (stdio mode):
```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

### HTTP mode (for ngrok and remote access)

You can expose the MCP server over HTTP using the Streamable HTTP transport for remote AI agents.

1. Set transport and port (default port is 3000):
```bash
MCP_TRANSPORT=http PORT=3000 npm start
```

2. Endpoints:
- `GET /health` — health check
- `POST /mcp` — MCP Streamable HTTP endpoint (handles initialization and tool calls)
- `GET /mcp` — Server-to-client notifications via streaming
- `DELETE /mcp` — Session termination

3. Using ngrok:
```bash
ngrok http http://localhost:3000
```

4. Configure your AI assistant with the ngrok URL:
```json
{
  "mcpServers": {
    "ticket-generator": {
      "url": "https://your-ngrok-url.ngrok-free.app/mcp"
    }
  }
}
```

### Production configuration

Set these environment variables when running in HTTP mode:

- `CORS_ORIGINS` — comma-separated allowed origins (omit to disable CORS)
- `RATE_WINDOW_MS` — rate-limit window in ms (default: 60000)
- `RATE_MAX` — max requests per IP per window (default: 60)
- `JSON_LIMIT` — JSON body limit (default: 200kb)
- `HOST` — bind host (default: 0.0.0.0)
- `PORT` — port (default: 3000)
- `LOG_FORMAT` — morgan format (default: combined)

Example:
```bash
export MCP_TRANSPORT=http
export CORS_ORIGINS=https://yourapp.com,https://admin.yourapp.com
export RATE_WINDOW_MS=60000
export RATE_MAX=60
export JSON_LIMIT=200kb
export PORT=3000
npm start
```

With ngrok:
```bash
ngrok http http://localhost:3000
```

The MCP endpoint will be available at: `https://your-ngrok-url.ngrok-free.app/mcp`

Configure your AI assistant (Claude Desktop, Cursor, etc.) to use this URL as shown in the HTTP mode section above.

### Available Tools

The MCP server provides the following tools for AI agents:

#### 1. `get_ticket_data`
Gets ticket data and information from the Ticket Generator API.

**Parameters:**
- `ticket_id` (required): The unique ID of the ticket to retrieve data for
- `event_id` (optional): The event ID associated with the ticket
- `user_id` (optional): The user ID who owns the ticket

#### 2. `get_ticket_url`
Generates a ticket URL for sharing or accessing the ticket.

**Parameters:**
- `ticket_id` (required): The unique ID of the ticket to get URL for
- `event_id` (optional): The event ID associated with the ticket
- `user_id` (optional): The user ID who owns the ticket
- `format` (optional): URL format preference (web, mobile, pdf) - default: web

#### 3. `send_ticket`
Sends a ticket via email or other delivery method.

**Parameters:**
- `ticket_id` (required): The unique ID of the ticket to send
- `recipient_email` (required): Email address to send the ticket to
- `recipient_name` (optional): Name of the recipient
- `delivery_method` (optional): Delivery method (email, sms, whatsapp) - default: email
- `message` (optional): Custom message to include with the ticket

#### 4. `get_event_details`
Gets event details and information from the Ticket Generator API.

**Parameters:**
- `event_id` (required): The unique ID of the event to get details for
- `include_tickets` (optional): Whether to include ticket information in the response - default: false
- `include_attendees` (optional): Whether to include attendee information in the response - default: false

## Integration with AI Agents

### Claude Desktop

Add this server to your Claude Desktop configuration:

1. Open Claude Desktop settings
2. Add a new MCP server with the following configuration:
   ```json
   {
     "mcpServers": {
       "ticket-generator": {
         "command": "node",
         "args": ["/path/to/your/ticket-generator-mcp/server.js"],
         "env": {
           "TG_API_KEY": "your_api_key_here"
         }
       }
     }
   }
   ```

### Cursor IDE

Configure Cursor to use this MCP server by adding it to your MCP configuration file.

## API Endpoints

This MCP server integrates with the following Ticket Generator API endpoints:

1. **`/ticket/data`** - Get ticket data and information
2. **`/ticket/url`** - Generate ticket URLs for sharing
3. **`/ticket/send`** - Send tickets via email or other delivery methods
4. **`/event/details`** - Get event details and information

For detailed information about the Ticket Generator APIs, visit:
[https://apis.ticket-generator.com/client/api-docs/](https://apis.ticket-generator.com/client/api-docs/)

## Error Handling

The MCP server includes comprehensive error handling:
- Invalid API keys are caught and reported
- Network errors are handled gracefully
- Invalid parameters are validated and error messages are provided
- All errors are returned in a structured format for AI agents to understand

## Development

### Project Structure

```
ticket-generator-mcp/
├── server.js          # Main MCP server implementation
├── package.json       # Node.js dependencies and scripts
├── .env.example       # Environment variables template
└── README.md          # This file
```

### Adding New Tools

To add new tools to the MCP server:

1. Add the tool definition to the `ListToolsRequestSchema` handler
2. Add the corresponding case in the `CallToolRequestSchema` handler
3. Implement the API call using the `makeTGRequest` helper function

## License

ISC

## Support

For issues related to:
- This MCP server: Create an issue in this repository
- Ticket Generator APIs: Contact Ticket Generator support
- MCP protocol: Refer to the [MCP documentation](https://modelcontextprotocol.io/)