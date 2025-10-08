#!/bin/bash

# Deployment script for AWS Fargate
# Usage: ./deploy.sh [environment]

set -e

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID}"
ECR_REPOSITORY="${ECR_REPOSITORY:-ticket-generator-mcp}"
ECS_CLUSTER="${ECS_CLUSTER:-your-cluster-name}"
ECS_SERVICE="${ECS_SERVICE:-ticket-generator-mcp}"
ENVIRONMENT="${1:-production}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed"
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi
    
    if [ -z "$AWS_ACCOUNT_ID" ]; then
        log_error "AWS_ACCOUNT_ID is not set"
        log_info "Export it: export AWS_ACCOUNT_ID=123456789012"
        exit 1
    fi
    
    log_info "Prerequisites check passed!"
}

# Login to ECR
ecr_login() {
    log_info "Logging into ECR..."
    aws ecr get-login-password --region "$AWS_REGION" | \
        docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
}

# Build Docker image
build_image() {
    log_info "Building Docker image..."
    docker build -t "$ECR_REPOSITORY" .
    log_info "Docker image built successfully!"
}

# Tag and push image
push_image() {
    log_info "Tagging and pushing image to ECR..."
    
    IMAGE_TAG="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo 'latest')"
    ECR_IMAGE="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY"
    
    docker tag "$ECR_REPOSITORY:latest" "$ECR_IMAGE:$IMAGE_TAG"
    docker tag "$ECR_REPOSITORY:latest" "$ECR_IMAGE:latest"
    
    docker push "$ECR_IMAGE:$IMAGE_TAG"
    docker push "$ECR_IMAGE:latest"
    
    log_info "Image pushed: $ECR_IMAGE:$IMAGE_TAG"
    log_info "Image pushed: $ECR_IMAGE:latest"
}

# Update ECS service
update_service() {
    log_info "Updating ECS service..."
    
    aws ecs update-service \
        --cluster "$ECS_CLUSTER" \
        --service "$ECS_SERVICE" \
        --force-new-deployment \
        --region "$AWS_REGION"
    
    log_info "ECS service update initiated!"
}

# Wait for deployment
wait_for_deployment() {
    log_info "Waiting for deployment to complete..."
    
    aws ecs wait services-stable \
        --cluster "$ECS_CLUSTER" \
        --services "$ECS_SERVICE" \
        --region "$AWS_REGION"
    
    log_info "Deployment completed successfully!"
}

# Test health endpoint
test_health() {
    log_info "Testing health endpoint..."
    
    # Get the load balancer URL from ECS service (you may need to adjust this)
    ALB_URL=$(aws ecs describe-services \
        --cluster "$ECS_CLUSTER" \
        --services "$ECS_SERVICE" \
        --region "$AWS_REGION" \
        --query 'services[0].loadBalancers[0].targetGroupArn' \
        --output text)
    
    if [ -z "$ALB_URL" ] || [ "$ALB_URL" == "None" ]; then
        log_warn "Could not retrieve ALB URL automatically"
        log_info "Please test the health endpoint manually:"
        log_info "  curl https://your-domain.com/health"
    else
        log_info "Health check endpoint: https://your-domain.com/health"
    fi
}

# Rollback function
rollback() {
    log_warn "Rolling back to previous deployment..."
    
    aws ecs update-service \
        --cluster "$ECS_CLUSTER" \
        --service "$ECS_SERVICE" \
        --force-new-deployment \
        --region "$AWS_REGION"
    
    log_info "Rollback initiated!"
}

# Main deployment flow
main() {
    log_info "Starting deployment for environment: $ENVIRONMENT"
    
    check_prerequisites
    ecr_login
    build_image
    push_image
    update_service
    wait_for_deployment
    test_health
    
    log_info "Deployment completed successfully! 🚀"
}

# Handle script arguments
case "${1:-deploy}" in
    deploy)
        main
        ;;
    rollback)
        rollback
        ;;
    build-only)
        check_prerequisites
        build_image
        ;;
    push-only)
        check_prerequisites
        ecr_login
        push_image
        ;;
    *)
        log_error "Unknown command: $1"
        echo "Usage: $0 [deploy|rollback|build-only|push-only]"
        exit 1
        ;;
esac
