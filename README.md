# Ticket Generator MCP Server

A Model Context Protocol (MCP) server that provides AI agents with access to the Ticket Generator APIs for managing tickets and events.

## Overview

This MCP server acts as a bridge between AI agents and the Ticket Generator APIs, allowing AI assistants to:
- Generate ticket IDs with QR code images (base64 PNG)
- Get hosted ticket URLs with optional variable field overrides
- Send tickets via email, SMS, or WhatsApp
- Retrieve event details for all active events on your account

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

**Important:** In HTTP transport mode, the API key is passed securely via the `Authorization` header from your MCP client configuration. It is:
- **Session-specific** — each client session has its own API key stored in memory
- **Transmitted securely** over HTTPS (production) or ngrok tunnel (development)

In stdio transport mode, the API key is read from the `TG_API_KEY` environment variable.

## Usage

This MCP server supports two transport modes: **HTTP** (for development and production deployments) and **stdio** (for local CLI usage). In HTTP mode the API key is securely passed from your MCP client configuration via the `Authorization` header. In stdio mode the key is read from the `TG_API_KEY` environment variable.

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

2. Set the required environment variable:
   ```bash
   export MCP_TRANSPORT=http
   ```
   > **Note:** The server listens on `0.0.0.0:3000` (hardcoded in `server.js`).

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
Generates a ticket ID and its QR Code image (base64 PNG) for a given event. Optionally pass a ticket category and image width.

**Parameters:**
- `eventId` (required): The Ticket Generator Event ID for which the ticket should be created
- `width` (required): QR image width/height in pixels (square). Allowed range: 300–1500. Default: 300
- `ticketCategoryId` (optional): Ticket Category ID. If the event has only one category, this can be omitted

#### 2. `get_ticket_url`
Returns a URL to the rendered QR Code ticket for the specified event (and optional category). You can optionally override up to 5 variable fields on the ticket design.

**Parameters:**
- `eventId` (required): Ticket Generator Event ID
- `ticketCategoryId` (optional): Ticket Category ID. Omit if the event has a single category
- `variables` (optional): Array of up to 5 variable field overrides, each with:
  - `value` (required): Value for this variable (e.g., `"Mark"`, `"A2"`)
  - `header` (optional): Header/label for this variable (e.g., `"Name"`, `"Seat"`). Leave empty to use the default label defined in the design

#### 3. `send_ticket`
Sends a generated ticket to a recipient via Email, SMS, or WhatsApp. You can include subject, body, and sender details, along with up to 5 custom variable fields.

**Parameters:**
- `eventId` (required): Ticket Generator Event ID
- `ticketCategoryId` (optional): Ticket Category ID. Omit if the event has a single category
- `email` (optional): Email address of the recipient (ticket will be sent here)
- `phoneNumber` (optional): Recipient's phone number for SMS delivery
- `whatsApp` (optional): Set `true` to send ticket via WhatsApp (requires `phoneNumber`)
- `whatsAppConsent` (optional): Whether the recipient has consented to receive WhatsApp messages (required if `whatsApp` is `true`)
- `subject` (optional): Subject line of the email (if `email` is provided)
- `body` (optional): Message body (HTML or plain text) for the email/SMS/WhatsApp message
- `fromName` (optional): The sender name shown to the recipient
- `variables` (optional): Array of up to 5 variable fields to personalize the ticket, each with:
  - `value` (required): Value corresponding to the header (e.g., `"A12"`, `"Mark"`)
  - `header` (optional): Variable header label (e.g., `"Seat"`, `"Name"`). Optional if default is set in design

#### 4. `get_events_details`
Returns the details (name, description, start date, end date, location, ticket categories, etc.) of all active events associated with your account.

**Parameters:**
- None — this tool takes no parameters and returns all active events for your API key

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

This MCP server integrates with the following Ticket Generator API endpoints (base URL: `https://apis.ticket-generator.com/client/v1`):

1. **`POST /ticket/data`** — Generate a ticket ID and QR code image
2. **`POST /ticket/url`** — Get a hosted URL for a rendered ticket
3. **`POST /ticket/send`** — Send a ticket via email, SMS, or WhatsApp
4. **`GET /event/details`** — Retrieve details for all active events

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
├── Dockerfile             # Docker container configuration
├── deploy.sh              # ECR build/push + ECS deployment script
├── task-definition.json   # AWS ECS Fargate task definition template
├── nginx.conf             # Nginx reverse proxy configuration
├── DEPLOYMENT.md          # AWS Fargate/ECS deployment guide
├── NGINX-SETUP.md         # Nginx setup options
├── PM2-GUIDE.md           # PM2 usage guide
└── README.md              # This file
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