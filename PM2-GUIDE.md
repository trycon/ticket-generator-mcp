# PM2 Usage Guide for Ticket Generator MCP

This guide covers how to use PM2 for local development and production deployment.

## What is PM2?

PM2 is a production-ready process manager for Node.js applications. It provides:
- **Process Management**: Keep your app running 24/7
- **Auto Restart**: Automatically restart on crashes
- **Load Balancing**: Built-in load balancer (cluster mode)
- **Log Management**: Centralized logging
- **Monitoring**: Real-time monitoring dashboard
- **Zero Downtime Reload**: Update without downtime

## Installation

PM2 is already included in `package.json`. After running `npm install`, you can use it via npm scripts or install globally:

```bash
# Install dependencies (includes PM2)
npm install

# Or install PM2 globally (optional)
npm install -g pm2
```

## Local Development with PM2

### Start the Application

```bash
# Using npm scripts (recommended)
npm run pm2:start

# Or using PM2 directly
pm2 start ecosystem.config.cjs
```

This will start the application in HTTP mode on port 3000.

### Monitor the Application

```bash
# View status of all applications
npm run pm2:status
# or
pm2 status

# View logs
npm run pm2:logs
# or
pm2 logs ticket-generator-mcp

# Real-time monitoring dashboard
npm run pm2:monit
# or
pm2 monit
```

### Manage the Application

```bash
# Restart the application
npm run pm2:restart

# Reload (zero downtime restart)
npm run pm2:reload

# Stop the application
npm run pm2:stop

# Delete from PM2 process list
npm run pm2:delete
```

## Configuration (`ecosystem.config.cjs`)

The PM2 configuration is in `ecosystem.config.cjs`:

```javascript
module.exports = {
  apps: [{
    name: 'ticket-generator-mcp',
    script: 'server.js',
    instances: 1,              // Number of instances (1 or 'max' for cluster)
    exec_mode: 'cluster',      // Cluster mode for load balancing
    autorestart: true,         // Auto restart on crash
    watch: false,              // Don't watch files in production
    max_memory_restart: '1G',  // Restart if memory exceeds 1GB
    env: {
      NODE_ENV: 'production',
      MCP_TRANSPORT: 'http',
      HOST: '0.0.0.0',
      PORT: 3000
    }
  }]
};
```

### Customizing Configuration

You can modify `ecosystem.config.cjs` to suit your needs:

```javascript
// Development configuration
module.exports = {
  apps: [{
    name: 'ticket-generator-mcp-dev',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',         // Fork mode for development
    watch: true,               // Watch files for changes
    ignore_watch: ['node_modules', 'logs'],
    env: {
      NODE_ENV: 'development',
      MCP_TRANSPORT: 'http',
      PORT: 3000,
      TG_API_KEY: process.env.TG_API_KEY
    }
  }]
};
```

## AWS Fargate Deployment

PM2 is configured to run in the Docker container. The Dockerfile uses `pm2-runtime`:

```dockerfile
CMD ["pm2-runtime", "start", "ecosystem.config.cjs"]
```

### Why PM2 in Fargate?

Even though Fargate provides container orchestration, PM2 adds value:

1. **Application-Level Monitoring**: PM2 monitors the Node.js process specifically
2. **Graceful Shutdown**: Handles SIGTERM signals properly
3. **Memory Management**: Restarts on memory threshold before OOM
4. **Cluster Mode**: Can run multiple Node.js processes in a single container
5. **Better Logging**: Structured logs with timestamps

### Cluster Mode in Fargate

For better CPU utilization in Fargate:

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'ticket-generator-mcp',
    script: 'server.js',
    instances: 'max',          // Use all available CPUs
    exec_mode: 'cluster',      // Enable cluster mode
    // ... rest of config
  }]
};
```

**Note**: With 256 CPU units (0.25 vCPU), using cluster mode may not be beneficial. Consider this for larger CPU allocations (512+ CPU units).

## PM2 Commands Reference

### Process Management

```bash
# Start
pm2 start ecosystem.config.cjs
pm2 start server.js --name ticket-generator-mcp

# Stop
pm2 stop ticket-generator-mcp    # Stop by name
pm2 stop 0                        # Stop by ID
pm2 stop all                      # Stop all

# Restart
pm2 restart ticket-generator-mcp  # Restart with downtime
pm2 reload ticket-generator-mcp   # Zero-downtime restart (cluster only)

# Delete
pm2 delete ticket-generator-mcp
pm2 delete all
```

### Monitoring

```bash
# List all processes
pm2 list
pm2 ls

# Show process details
pm2 show ticket-generator-mcp

# Monitor in real-time
pm2 monit

# View logs
pm2 logs                          # All logs
pm2 logs ticket-generator-mcp     # Specific app logs
pm2 logs --lines 100              # Last 100 lines
pm2 logs --err                    # Error logs only

# Flush logs
pm2 flush
```

### Cluster Management

```bash
# Scale to N instances
pm2 scale ticket-generator-mcp 4

# Reload all instances
pm2 reload all
```

### System Information

```bash
# PM2 info
pm2 info ticket-generator-mcp

# System info
pm2 sysmonit

# List all processes with details
pm2 prettylist
```

## Environment Variables

### Setting Environment Variables

#### Option 1: In ecosystem.config.cjs
```javascript
env: {
  NODE_ENV: 'production',
  TG_API_KEY: 'your_key_here'
}
```

#### Option 2: Using .env file

Create a `.env` file:
```
NODE_ENV=production
MCP_TRANSPORT=http
TG_API_KEY=your_api_key
PORT=3000
```

Update ecosystem.config.cjs:
```javascript
module.exports = {
  apps: [{
    name: 'ticket-generator-mcp',
    script: 'server.js',
    env_file: '.env',  // Load from .env file
    // ...
  }]
};
```

#### Option 3: Using shell environment
```bash
export TG_API_KEY=your_key_here
pm2 start ecosystem.config.cjs
```

## Log Management

PM2 automatically manages logs. Logs are stored in:
- Out logs: `./logs/out.log`
- Error logs: `./logs/err.log`

### Log Rotation

Install PM2 log rotate module:
```bash
pm2 install pm2-logrotate

# Configure
pm2 set pm2-logrotate:max_size 10M        # Max file size
pm2 set pm2-logrotate:retain 30           # Keep 30 files
pm2 set pm2-logrotate:compress true       # Compress old logs
```

## Startup Script (For VMs/EC2)

If deploying to a VM instead of Fargate:

```bash
# Generate startup script
pm2 startup

# Save current process list
pm2 save

# Now PM2 will start automatically on system boot
```

To remove:
```bash
pm2 unstartup
```

## Health Checks

The application has a built-in health endpoint at `/health`. You can use PM2 to monitor it:

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'ticket-generator-mcp',
    script: 'server.js',
    // Health check (PM2 Plus feature)
    health_check: {
      url: 'http://localhost:3000/health',
      interval: 30000  // Check every 30 seconds
    }
  }]
};
```

**Note**: Health checks require PM2 Plus (paid service). For basic health checks, rely on the Dockerfile HEALTHCHECK and AWS ECS health checks.

## Troubleshooting

### Process Won't Start

```bash
# Check logs
pm2 logs ticket-generator-mcp --lines 50

# Check PM2 daemon logs
pm2 logs pm2
```

### High Memory Usage

```bash
# Check memory
pm2 monit

# Restart with lower memory limit
pm2 restart ticket-generator-mcp --max-memory-restart 512M
```

### Can't Connect to Application

```bash
# Check if process is running
pm2 list

# Check if port is in use
lsof -i :3000  # Linux/Mac
netstat -ano | findstr :3000  # Windows

# Check logs for errors
pm2 logs ticket-generator-mcp --err
```

### PM2 Daemon Not Responding

```bash
# Kill PM2 daemon
pm2 kill

# Restart
pm2 start ecosystem.config.cjs
```

## Best Practices

### Production
1. ✅ Use `exec_mode: 'cluster'` with `instances: 'max'` for CPU-intensive apps
2. ✅ Set `watch: false` (file watching is for development only)
3. ✅ Configure `max_memory_restart` to prevent memory leaks
4. ✅ Use `pm2-runtime` in Docker containers (not `pm2 start`)
5. ✅ Store API keys in AWS Secrets Manager, not in ecosystem.config.cjs
6. ✅ Enable log rotation
7. ✅ Set up monitoring and alerts

### Development
1. ✅ Use `watch: true` for auto-restart on file changes
2. ✅ Use `exec_mode: 'fork'` with `instances: 1`
3. ✅ Use `npm run pm2:logs` to view logs during development
4. ✅ Use separate ecosystem files for dev/prod

## PM2 Plus (Optional Monitoring Service)

PM2 Plus is a paid monitoring service that provides:
- Real-time dashboard
- Alerts and notifications
- Custom metrics
- Exception tracking
- Transaction tracing

To use PM2 Plus:
```bash
pm2 link <secret_key> <public_key>
pm2 start ecosystem.config.cjs
```

Visit: https://pm2.io/

## Testing PM2 Setup Locally

Before deploying to Fargate, test the PM2 setup locally:

```bash
# Install dependencies
npm install

# Start with PM2
npm run pm2:start

# Check status
npm run pm2:status

# Test health endpoint
curl http://localhost:3000/health

# Test MCP endpoint
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: your_api_key" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}'

# Monitor logs
npm run pm2:logs

# Stop
npm run pm2:stop
```

## Docker Testing

Test the Docker image with PM2:

```bash
# Build image
docker build -t ticket-generator-mcp .

# Run container
docker run -d \
  -p 3000:3000 \
  -e TG_API_KEY=your_api_key \
  --name mcp-test \
  ticket-generator-mcp

# Check PM2 status inside container
docker exec mcp-test pm2 status

# Check logs
docker logs mcp-test
docker exec mcp-test pm2 logs --lines 50

# Stop
docker stop mcp-test
docker rm mcp-test
```

## Additional Resources

- PM2 Documentation: https://pm2.keymetrics.io/docs/usage/quick-start/
- PM2 Cluster Mode: https://pm2.keymetrics.io/docs/usage/cluster-mode/
- PM2 Docker Integration: https://pm2.keymetrics.io/docs/usage/docker-pm2-nodejs/
- AWS Fargate Documentation: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html
