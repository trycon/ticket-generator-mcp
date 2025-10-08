# Nginx Setup Guide for Ticket Generator MCP

This guide explains how to set up nginx as a reverse proxy for the Ticket Generator MCP server on AWS Fargate.

## Architecture Options

### Option 1: ALB Only (Recommended)
```
Internet → ALB (HTTPS) → Fargate Tasks (HTTP:3000)
```
- Simplest setup
- AWS manages SSL/TLS
- No nginx needed
- Use ALB for health checks and load balancing

### Option 2: ALB + Nginx Sidecar
```
Internet → ALB → Nginx Container → MCP Container (same task)
```
- Additional layer for custom nginx features
- More complex but more control

### Option 3: Separate Nginx Service
```
Internet → ALB → Nginx Service → MCP Service (internal ALB)
```
- Complete separation
- Most complex but most flexible

## Option 1: ALB Only Setup (Recommended)

This is the simplest and most cost-effective option.

### 1. Create Target Group

```bash
aws elbv2 create-target-group \
  --name ticket-generator-mcp-tg \
  --protocol HTTP \
  --port 3000 \
  --vpc-id vpc-xxxxx \
  --target-type ip \
  --health-check-enabled \
  --health-check-path /health \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --matcher HttpCode=200
```

### 2. Create or Update ALB Listener

For HTTPS (recommended):
```bash
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:us-east-1:ACCOUNT:loadbalancer/app/my-alb/xxx \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=arn:aws:acm:us-east-1:ACCOUNT:certificate/xxx \
  --default-actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:us-east-1:ACCOUNT:targetgroup/ticket-generator-mcp-tg/xxx
```

For HTTP (not recommended for production):
```bash
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:us-east-1:ACCOUNT:loadbalancer/app/my-alb/xxx \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:us-east-1:ACCOUNT:targetgroup/ticket-generator-mcp-tg/xxx
```

### 3. Configure Security Groups

**ALB Security Group:**
```
Inbound:
- Port 443 (HTTPS) from 0.0.0.0/0
- Port 80 (HTTP) from 0.0.0.0/0 (optional, for redirect)

Outbound:
- Port 3000 to ECS Task Security Group
```

**ECS Task Security Group:**
```
Inbound:
- Port 3000 from ALB Security Group

Outbound:
- Port 443 to 0.0.0.0/0 (for API calls)
```

### 4. Update ECS Service with ALB

```bash
aws ecs create-service \
  --cluster your-cluster \
  --service-name ticket-generator-mcp \
  --task-definition ticket-generator-mcp \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx,subnet-yyy],securityGroups=[sg-xxx],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=ticket-generator-mcp,containerPort=3000" \
  --health-check-grace-period-seconds 60
```

### 5. Configure DNS

Point your domain to the ALB:
```
ticket-generator.example.com → ALB DNS Name
```

**Done!** Your MCP server is now accessible at `https://ticket-generator.example.com/`

## Option 2: Nginx Sidecar Container

If you need custom nginx features (custom headers, caching, etc.), run nginx as a sidecar container.

### 1. Create Multi-Container Task Definition

```json
{
  "family": "ticket-generator-mcp-nginx",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "nginx",
      "image": "YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/ticket-generator-nginx:latest",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 80,
          "protocol": "tcp"
        }
      ],
      "dependsOn": [
        {
          "containerName": "mcp-server",
          "condition": "HEALTHY"
        }
      ],
      "environment": [
        {
          "name": "BACKEND_HOST",
          "value": "localhost"
        },
        {
          "name": "BACKEND_PORT",
          "value": "3000"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/ticket-generator-nginx",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "nginx"
        }
      }
    },
    {
      "name": "mcp-server",
      "image": "YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/ticket-generator-mcp:latest",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "MCP_TRANSPORT",
          "value": "http"
        },
        {
          "name": "HOST",
          "value": "127.0.0.1"
        },
        {
          "name": "PORT",
          "value": "3000"
        }
      ],
      "secrets": [
        {
          "name": "TG_API_KEY",
          "valueFrom": "arn:aws:secretsmanager:..."
        }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})\""],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/ticket-generator-mcp",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "mcp"
        }
      }
    }
  ]
}
```

### 2. Update Nginx Configuration for Sidecar

Update `nginx.conf` to use localhost:

```nginx
upstream ticket_generator_mcp {
    server 127.0.0.1:3000;
    keepalive 64;
}

# ... rest of config
```

### 3. Build and Push Nginx Image

```bash
# Create nginx/Dockerfile
mkdir nginx
cp nginx.conf nginx/

# Create nginx/Dockerfile
cat > nginx/Dockerfile <<EOF
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
EOF

# Build and push
cd nginx
docker build -t ticket-generator-nginx .
docker tag ticket-generator-nginx:latest YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/ticket-generator-nginx:latest
docker push YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/ticket-generator-nginx:latest
```

### 4. Update Target Group to Port 80

```bash
# Target nginx container on port 80
aws elbv2 create-target-group \
  --name ticket-generator-nginx-tg \
  --protocol HTTP \
  --port 80 \
  --vpc-id vpc-xxxxx \
  --target-type ip \
  --health-check-path /health
```

## Nginx Configuration Details

The provided `nginx.conf` includes:

### Security Headers
```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

### MCP-Specific Headers
```nginx
proxy_set_header mcp-session-id $http_mcp_session_id;
proxy_set_header Authorization $http_authorization;
```

### Streaming Support
```nginx
proxy_buffering off;
proxy_cache off;
chunked_transfer_encoding on;
```

### Timeouts
```nginx
proxy_connect_timeout 60s;
proxy_send_timeout 60s;
proxy_read_timeout 60s;
```

## Custom Nginx Features

### Rate Limiting

Add to nginx.conf:
```nginx
http {
    limit_req_zone $binary_remote_addr zone=mcp_limit:10m rate=10r/s;
    
    server {
        location /mcp {
            limit_req zone=mcp_limit burst=20 nodelay;
            # ... rest of config
        }
    }
}
```

### Caching (if applicable)

```nginx
http {
    proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=mcp_cache:10m max_size=100m inactive=60m;
    
    server {
        location /health {
            proxy_cache mcp_cache;
            proxy_cache_valid 200 1m;
            # ... rest of config
        }
    }
}
```

### Custom Logging

```nginx
log_format mcp_log '$remote_addr - $remote_user [$time_local] '
                   '"$request" $status $body_bytes_sent '
                   '"$http_mcp_session_id" "$http_authorization"';

access_log /var/log/nginx/mcp-access.log mcp_log;
```

## SSL/TLS Configuration

### At ALB Level (Recommended)
- Use AWS Certificate Manager (ACM)
- Free SSL certificates
- Auto-renewal
- No nginx SSL config needed

### At Nginx Level (if using nginx directly)

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # OCSP stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    
    # ... rest of config
}

# HTTP to HTTPS redirect
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

## Testing Nginx Configuration

### Local Testing

```bash
# Test nginx config syntax
docker run --rm -v $(pwd)/nginx.conf:/etc/nginx/conf.d/default.conf nginx nginx -t

# Run nginx locally
docker run -d -p 8080:80 \
  -v $(pwd)/nginx.conf:/etc/nginx/conf.d/default.conf \
  --name nginx-test \
  nginx:alpine

# Test
curl http://localhost:8080/health

# Stop
docker stop nginx-test && docker rm nginx-test
```

### Testing with MCP Server

```bash
# Terminal 1: Start MCP server
npm run pm2:start

# Terminal 2: Start nginx
docker run -d -p 8080:80 \
  -v $(pwd)/nginx.conf:/etc/nginx/conf.d/default.conf \
  --network host \
  --name nginx-test \
  nginx:alpine

# Terminal 3: Test
curl http://localhost:8080/health
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: your_api_key" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}'

# Cleanup
docker stop nginx-test && docker rm nginx-test
npm run pm2:stop
```

## Monitoring Nginx

### CloudWatch Logs

View nginx logs in CloudWatch:
```bash
aws logs tail /ecs/ticket-generator-nginx --follow
```

### Nginx Status Page (Optional)

Add to nginx.conf:
```nginx
location /nginx_status {
    stub_status on;
    access_log off;
    allow 127.0.0.1;
    deny all;
}
```

## Troubleshooting

### 502 Bad Gateway

**Check:**
1. MCP server is running: `curl http://localhost:3000/health`
2. Nginx can reach MCP server (check upstream config)
3. Security groups allow traffic
4. Check nginx error logs

```bash
# Check logs
aws logs tail /ecs/ticket-generator-nginx --follow

# Or in container
docker exec nginx-container cat /var/log/nginx/error.log
```

### 504 Gateway Timeout

**Fix:**
Increase timeouts in nginx.conf:
```nginx
proxy_connect_timeout 120s;
proxy_send_timeout 120s;
proxy_read_timeout 120s;
```

### Connection Refused

**Check:**
1. MCP server is listening on correct port
2. Upstream configuration is correct
3. Network connectivity (same task/service discovery)

## Best Practices

1. ✅ Use ALB for SSL termination (simpler, free certs)
2. ✅ Enable health checks at both ALB and nginx levels
3. ✅ Use security groups to restrict access
4. ✅ Enable access logs for debugging
5. ✅ Set appropriate timeouts for MCP operations
6. ✅ Disable proxy buffering for streaming responses
7. ✅ Use HTTP/2 for better performance
8. ✅ Implement rate limiting at ALB or nginx level
9. ✅ Monitor nginx and MCP server logs
10. ✅ Test thoroughly before production deployment

## Recommended Setup Summary

For most use cases, **use Option 1 (ALB Only)**:
- Simplest architecture
- Lowest cost
- AWS-managed SSL/TLS
- Built-in health checks
- Auto-scaling support
- CloudWatch integration

Only use nginx if you need:
- Custom request/response transformations
- Advanced caching strategies
- Custom rate limiting logic
- Specific nginx modules
- Complex routing rules
