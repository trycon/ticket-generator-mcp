# AWS Fargate Deployment Guide with PM2 and Nginx

This guide explains how to deploy the Ticket Generator MCP server on AWS Fargate with PM2 process management and nginx as a reverse proxy.

## Architecture Overview

```
Internet → ALB/NLB → Nginx (Fargate Service) → MCP Server (Fargate Service with PM2)
```

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI configured
- Docker installed locally
- ECR repository created
- ECS cluster created
- VPC with public/private subnets configured

## Option 1: Direct Fargate Deployment (Recommended)

### Step 1: Build and Push Docker Image

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Build the image
docker build -t ticket-generator-mcp .

# Tag the image
docker tag ticket-generator-mcp:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/ticket-generator-mcp:latest

# Push to ECR
docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/ticket-generator-mcp:latest
```

### Step 2: Create ECS Task Definition

Create a file `task-definition.json`:

```json
{
  "family": "ticket-generator-mcp",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::YOUR_ACCOUNT_ID:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::YOUR_ACCOUNT_ID:role/ecsTaskRole",
  "containerDefinitions": [
    {
      "name": "ticket-generator-mcp",
      "image": "YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/ticket-generator-mcp:latest",
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
          "value": "0.0.0.0"
        },
        {
          "name": "PORT",
          "value": "3000"
        }
      ],
      "secrets": [
        {
          "name": "TG_API_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:ticket-generator/api-key"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/ticket-generator-mcp",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})\""],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

Register the task definition:

```bash
aws ecs register-task-definition --cli-input-json file://task-definition.json
```

### Step 3: Create CloudWatch Log Group

```bash
aws logs create-log-group --log-group-name /ecs/ticket-generator-mcp
```

### Step 4: Store API Key in Secrets Manager

```bash
aws secretsmanager create-secret \
  --name ticket-generator/api-key \
  --description "Ticket Generator API Key" \
  --secret-string "YOUR_ACTUAL_API_KEY"
```

### Step 5: Create ECS Service

```bash
aws ecs create-service \
  --cluster your-cluster-name \
  --service-name ticket-generator-mcp \
  --task-definition ticket-generator-mcp \
  --desired-count 2 \
  --launch-type FARGATE \
  --platform-version LATEST \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxxxx,subnet-yyyyy],securityGroups=[sg-xxxxx],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:us-east-1:YOUR_ACCOUNT_ID:targetgroup/ticket-generator-mcp/xxxxx,containerName=ticket-generator-mcp,containerPort=3000" \
  --health-check-grace-period-seconds 60
```

## Option 2: With Nginx Reverse Proxy

If you want to run nginx in front of your application in separate Fargate tasks:

### Step 1: Create Nginx Dockerfile

Create `nginx/Dockerfile`:

```dockerfile
FROM nginx:alpine

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy custom nginx.conf if needed
# COPY nginx-main.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

### Step 2: Build and Push Nginx Image

```bash
# Build nginx image
cd nginx
docker build -t ticket-generator-nginx .

# Tag and push
docker tag ticket-generator-nginx:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/ticket-generator-nginx:latest
docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/ticket-generator-nginx:latest
```

### Step 3: Create Nginx Service

Configure the nginx service to point to the MCP service using AWS Service Discovery or internal load balancer.

## PM2 Benefits in Fargate

Even though Fargate restarts containers automatically, PM2 provides additional benefits:

1. **Process Monitoring**: PM2 monitors your Node.js process and restarts it if it crashes
2. **Graceful Shutdown**: Handles SIGTERM from Fargate gracefully
3. **Log Management**: Structured logging with rotation
4. **Memory Management**: Automatic restart on memory threshold
5. **Cluster Mode**: Can run multiple instances within a container
6. **Zero-Downtime Reload**: When updating the application

## Environment Variables Configuration

Set these environment variables in your task definition:

### Required:
- `NODE_ENV`: `production`
- `MCP_TRANSPORT`: `http`
- `HOST`: `0.0.0.0`
- `PORT`: `3000`
- `TG_API_KEY`: Your Ticket Generator API key (use Secrets Manager)

### Optional:
- `CORS_ORIGINS`: Comma-separated allowed origins
- `RATE_WINDOW_MS`: Rate limit window (default: 60000)
- `RATE_MAX`: Max requests per window (default: 60)
- `JSON_LIMIT`: JSON body size limit (default: 200kb)
- `LOG_FORMAT`: Morgan log format (default: combined)

## Scaling Configuration

### Auto Scaling Policy

```bash
# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/your-cluster/ticket-generator-mcp \
  --min-capacity 2 \
  --max-capacity 10

# Create scaling policy (CPU-based)
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/your-cluster/ticket-generator-mcp \
  --policy-name cpu-scaling-policy \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration file://scaling-policy.json
```

`scaling-policy.json`:
```json
{
  "TargetValue": 70.0,
  "PredefinedMetricSpecification": {
    "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
  },
  "ScaleInCooldown": 300,
  "ScaleOutCooldown": 60
}
```

## Monitoring and Logging

### CloudWatch Metrics

Monitor these key metrics:
- `CPUUtilization`
- `MemoryUtilization`
- `HealthyHostCount` (from ALB)
- `TargetResponseTime`

### CloudWatch Logs

View logs:
```bash
aws logs tail /ecs/ticket-generator-mcp --follow
```

### PM2 Logs in Container

If you need to check PM2 logs inside a running container:

```bash
# Get task ID
aws ecs list-tasks --cluster your-cluster --service-name ticket-generator-mcp

# Execute command in container
aws ecs execute-command \
  --cluster your-cluster \
  --task TASK_ID \
  --container ticket-generator-mcp \
  --interactive \
  --command "/bin/sh"

# Inside container
pm2 logs
pm2 status
pm2 monit
```

## Load Balancer Configuration

### Application Load Balancer (ALB) - Recommended

Create target group:
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
  --unhealthy-threshold-count 3
```

Create listener rule to forward traffic to target group.

## Security Best Practices

1. **Use Secrets Manager** for API keys, never hardcode them
2. **Enable Container Insights** for enhanced monitoring
3. **Use Private Subnets** with NAT Gateway for production
4. **Implement WAF** rules on ALB for additional security
5. **Enable VPC Flow Logs** for network monitoring
6. **Use Security Groups** to restrict traffic
7. **Enable ALB access logs**
8. **Implement SSL/TLS** termination at ALB level
9. **Use IAM roles** with least privilege principle
10. **Enable AWS X-Ray** for distributed tracing

## Troubleshooting

### Container Not Starting

```bash
# Check logs
aws logs tail /ecs/ticket-generator-mcp --follow

# Describe tasks
aws ecs describe-tasks --cluster your-cluster --tasks TASK_ID
```

### Health Check Failing

```bash
# Test health endpoint locally
curl http://localhost:3000/health

# Check security group rules
# Ensure port 3000 is accessible from ALB security group
```

### PM2 Issues

```bash
# Access container
aws ecs execute-command --cluster your-cluster --task TASK_ID --container ticket-generator-mcp --interactive --command "/bin/sh"

# Check PM2 status
pm2 status
pm2 logs --lines 100
```

## Cost Optimization

1. **Right-size resources**: Start with 256 CPU / 512 MB memory
2. **Use Spot capacity** for non-critical workloads
3. **Implement auto-scaling** to scale down during low traffic
4. **Use Fargate Spot** for cost savings (up to 70% cheaper)
5. **Monitor CloudWatch metrics** to optimize resource allocation

## CI/CD Pipeline Example (GitHub Actions)

```yaml
name: Deploy to AWS Fargate

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v2
    
    - name: Configure AWS credentials
      uses: aws-actions/configure-aws-credentials@v1
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: us-east-1
    
    - name: Login to Amazon ECR
      id: login-ecr
      uses: aws-actions/amazon-ecr-login@v1
    
    - name: Build, tag, and push image to Amazon ECR
      env:
        ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
        ECR_REPOSITORY: ticket-generator-mcp
        IMAGE_TAG: ${{ github.sha }}
      run: |
        docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
        docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
        docker tag $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG $ECR_REGISTRY/$ECR_REPOSITORY:latest
        docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest
    
    - name: Update ECS service
      run: |
        aws ecs update-service --cluster your-cluster --service ticket-generator-mcp --force-new-deployment
```

## Local Testing

Test the Docker image locally before deploying:

```bash
# Build image
docker build -t ticket-generator-mcp .

# Run container
docker run -d \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e MCP_TRANSPORT=http \
  -e TG_API_KEY=your_api_key \
  --name mcp-test \
  ticket-generator-mcp

# Test health endpoint
curl http://localhost:3000/health

# Test MCP endpoint
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: your_api_key" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}'

# Check logs
docker logs mcp-test

# Check PM2 status inside container
docker exec mcp-test pm2 status

# Stop and remove
docker stop mcp-test
docker rm mcp-test
```

## Support

For issues related to:
- AWS Fargate: Check AWS documentation
- PM2: Check PM2 documentation
- Application: Check application logs in CloudWatch
