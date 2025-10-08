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
- (For local development) [ngrok](https://ngrok.com/) for exposing local server

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server (HTTP mode):**
   ```bash
   npm run dev:http
   ```

3. **Expose locally with ngrok:**
   ```bash
   ngrok http 3000
   ```

4. **Configure your MCP client** with the ngrok URL and your API key:
   ```json
   {
     "mcpServers": {
       "ticket-generator": {
         "url": "https://your-ngrok-url.ngrok-free.app/mcp",
         "headers": {
           "Authorization": "your_ticket_generator_api_key"
         }
       }
     }
   }
   ```

## API Key Security

**Important:** The API key is passed securely via the `Authorization` header from your MCP client configuration. It is:
- **Never stored** in environment variables or `.env` files
- **Session-specific** - each client session has its own API key
- **Transmitted securely** over HTTPS (production) or ngrok tunnel (development)

## Usage

This MCP server runs in **HTTP transport mode** for both development and production. The API key is securely passed from your MCP client configuration.

### Local Development with ngrok

1. Start the MCP server in HTTP mode:
   ```bash
   npm run dev:http
   ```
   This will start the server on `http://localhost:3000`

2. In a separate terminal, expose your local server using ngrok:
   ```bash
   ngrok http 3000
   ```
   
3. Copy the ngrok forwarding URL (e.g., `https://abc123.ngrok-free.app`)

4. Configure your MCP client (Claude Desktop, Cursor, etc.) with the ngrok URL and your API key:
   ```json
   {
     "mcpServers": {
       "ticket-generator": {
         "url": "https://abc123.ngrok-free.app/mcp",
         "headers": {
           "Authorization": "your_ticket_generator_api_key"
         }
       }
     }
   }
   ```

### Production Deployment

For production deployment, follow these steps:

1. Deploy the server to your hosting platform (AWS, DigitalOcean, etc.)

2. Set the required environment variables:
   ```bash
   export MCP_TRANSPORT=http
   export PORT=3000
   export HOST=0.0.0.0
   ```

3. Optional environment variables for production:
   - `CORS_ORIGINS` — comma-separated allowed origins (e.g., `https://yourapp.com`)
   - `RATE_WINDOW_MS` — rate-limit window in ms (default: 60000)
   - `RATE_MAX` — max requests per IP per window (default: 60)
   - `JSON_LIMIT` — JSON body limit (default: 200kb)
   - `LOG_FORMAT` — morgan log format (default: combined)

4. Start the server:
   ```bash
   npm start
   ```

5. Configure your MCP client with your production URL:
   ```json
   {
     "mcpServers": {
       "ticket-generator": {
         "url": "https://your-production-domain.com/mcp",
         "headers": {
           "Authorization": "your_ticket_generator_api_key"
         }
       }
     }
   }
   ```

### Server Endpoints

- `GET /health` — Health check endpoint
- `POST /mcp` — MCP initialization and tool call handling
- `GET /mcp` — Server-to-client notifications via streaming
- `DELETE /mcp` — Session termination

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

## Integration with MCP Clients

### Claude Desktop

Add this server to your Claude Desktop configuration file (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ticket-generator": {
      "url": "https://your-server-url.com/mcp",
      "headers": {
        "Authorization": "your_ticket_generator_api_key"
      }
    }
  }
}
```

For local development with ngrok:
```json
{
  "mcpServers": {
    "ticket-generator": {
      "url": "https://abc123.ngrok-free.app/mcp",
      "headers": {
        "Authorization": "your_ticket_generator_api_key"
      }
    }
  }
}
```

### Cursor IDE

Add the server to your Cursor MCP configuration:

```json
{
  "mcpServers": {
    "ticket-generator": {
      "url": "https://your-server-url.com/mcp",
      "headers": {
        "Authorization": "your_ticket_generator_api_key"
      }
    }
  }
}
```

### Other MCP Clients

Any MCP-compatible client can connect to this server using HTTP transport. Configure it with:
- **URL**: Your server endpoint (e.g., `https://your-domain.com/mcp`)
- **Authorization Header**: Your Ticket Generator API key

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
├── server.js              # Main MCP server implementation
├── package.json           # Node.js dependencies and scripts
├── ecosystem.config.cjs   # PM2 configuration for production
├── deploy.sh             # Deployment script
├── nginx.conf            # Nginx reverse proxy configuration
├── Dockerfile            # Docker container configuration
└── README.md             # This file
```

### Adding New Tools

To add new tools to the MCP server:

1. Add the tool definition to the `getToolDefinitions()` function
2. Add the corresponding case in the `handleToolCall()` function
3. Implement the API call using the `makeTGRequest` helper function

### Local Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server in development mode:
   ```bash
   npm run dev:http
   ```

3. In a separate terminal, start ngrok:
   ```bash
   ngrok http 3000
   ```

4. Use the ngrok URL to configure your MCP client with your API key in the Authorization header

## License

ISC

## Support

For issues related to:
- This MCP server: Create an issue in this repository
- Ticket Generator APIs: Contact Ticket Generator support
- MCP protocol: Refer to the [MCP documentation](https://modelcontextprotocol.io/)