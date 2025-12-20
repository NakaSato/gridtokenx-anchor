#!/bin/bash
set -e

# ============================================
# GridTokenX AWS ECS Deployment Script
# ============================================
# FOR RESEARCH USE ONLY - Master's Degree Paper
# Instance: t3.medium (2 vCPU, 4GB RAM)
# NOT FOR PRODUCTION USE
# ============================================
# Usage: ./deploy.sh [create|update|delete]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Configuration
PROJECT_NAME="${PROJECT_NAME:-gridtokenx}"
AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${PROJECT_NAME}-infrastructure"
ECR_REPO_NAME="${PROJECT_NAME}-solana"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI not found. Please install: https://aws.amazon.com/cli/"
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker not found. Please install Docker."
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials not configured. Run 'aws configure' first."
        exit 1
    fi
    
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}"
    
    log_success "Prerequisites check passed"
    log_info "AWS Account: ${AWS_ACCOUNT_ID}"
    log_info "Region: ${AWS_REGION}"
}

# Build and push Docker image
build_and_push() {
    log_info "Building Docker image..."
    
    cd "$PROJECT_DIR"
    docker build -t "${ECR_REPO_NAME}:latest" .
    
    log_info "Authenticating with ECR..."
    aws ecr get-login-password --region "$AWS_REGION" | \
        docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    
    # Create ECR repository if it doesn't exist (for initial deployment)
    aws ecr describe-repositories --repository-names "$ECR_REPO_NAME" --region "$AWS_REGION" 2>/dev/null || \
        aws ecr create-repository --repository-name "$ECR_REPO_NAME" --region "$AWS_REGION"
    
    log_info "Pushing image to ECR..."
    docker tag "${ECR_REPO_NAME}:latest" "${ECR_URI}:latest"
    docker push "${ECR_URI}:latest"
    
    log_success "Docker image pushed successfully"
}

# Deploy CloudFormation stack
deploy_stack() {
    local action="${1:-create}"
    
    log_info "Deploying CloudFormation stack (${action})..."
    
    if [ "$action" == "create" ]; then
        aws cloudformation create-stack \
            --stack-name "$STACK_NAME" \
            --template-body "file://${SCRIPT_DIR}/cloudformation.yaml" \
            --parameters \
                ParameterKey=ProjectName,ParameterValue="$PROJECT_NAME" \
                ParameterKey=Environment,ParameterValue=research \
            --capabilities CAPABILITY_NAMED_IAM \
            --region "$AWS_REGION"
        
        log_info "Waiting for stack creation..."
        aws cloudformation wait stack-create-complete \
            --stack-name "$STACK_NAME" \
            --region "$AWS_REGION"
    else
        aws cloudformation update-stack \
            --stack-name "$STACK_NAME" \
            --template-body "file://${SCRIPT_DIR}/cloudformation.yaml" \
            --parameters \
                ParameterKey=ProjectName,ParameterValue="$PROJECT_NAME" \
                ParameterKey=Environment,ParameterValue=research \
            --capabilities CAPABILITY_NAMED_IAM \
            --region "$AWS_REGION" 2>/dev/null || true
        
        log_info "Waiting for stack update..."
        aws cloudformation wait stack-update-complete \
            --stack-name "$STACK_NAME" \
            --region "$AWS_REGION" 2>/dev/null || true
    fi
    
    log_success "CloudFormation stack deployed"
}

# Update ECS service to deploy new image
update_service() {
    log_info "Updating ECS service..."
    
    local cluster_name="${PROJECT_NAME}-cluster"
    local service_name="${PROJECT_NAME}-solana-service"
    
    aws ecs update-service \
        --cluster "$cluster_name" \
        --service "$service_name" \
        --force-new-deployment \
        --region "$AWS_REGION"
    
    log_info "Waiting for service to stabilize..."
    aws ecs wait services-stable \
        --cluster "$cluster_name" \
        --services "$service_name" \
        --region "$AWS_REGION"
    
    log_success "ECS service updated and healthy"
}

# Get service endpoint
get_endpoint() {
    log_info "Getting service endpoint..."
    
    local cluster_name="${PROJECT_NAME}-cluster"
    local service_name="${PROJECT_NAME}-solana-service"
    
    # Get task ARN
    local task_arn=$(aws ecs list-tasks \
        --cluster "$cluster_name" \
        --service-name "$service_name" \
        --query 'taskArns[0]' \
        --output text \
        --region "$AWS_REGION")
    
    if [ "$task_arn" == "None" ] || [ -z "$task_arn" ]; then
        log_warning "No running tasks found"
        return
    fi
    
    # Get ENI ID
    local eni_id=$(aws ecs describe-tasks \
        --cluster "$cluster_name" \
        --tasks "$task_arn" \
        --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value' \
        --output text \
        --region "$AWS_REGION")
    
    # Get public IP
    local public_ip=$(aws ec2 describe-network-interfaces \
        --network-interface-ids "$eni_id" \
        --query 'NetworkInterfaces[0].Association.PublicIp' \
        --output text \
        --region "$AWS_REGION")
    
    if [ -n "$public_ip" ] && [ "$public_ip" != "None" ]; then
        log_success "Solana RPC Endpoint: http://${public_ip}:8899"
        log_info "Faucet Endpoint: http://${public_ip}:9900"
        
        echo ""
        echo "Test the endpoint:"
        echo "  curl http://${public_ip}:8899 -X POST -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getHealth\"}'"
    else
        log_warning "Could not determine public IP. Check AWS Console."
    fi
}

# Delete stack
delete_stack() {
    log_warning "Deleting CloudFormation stack..."
    
    read -p "Are you sure you want to delete the stack? (y/N): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        log_info "Deletion cancelled"
        return
    fi
    
    aws cloudformation delete-stack \
        --stack-name "$STACK_NAME" \
        --region "$AWS_REGION"
    
    log_info "Waiting for stack deletion..."
    aws cloudformation wait stack-delete-complete \
        --stack-name "$STACK_NAME" \
        --region "$AWS_REGION"
    
    log_success "Stack deleted successfully"
}

# Show usage
usage() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  deploy    - Full deployment (build, push, create/update stack)"
    echo "  update    - Update existing deployment with new image"
    echo "  status    - Show service status and endpoint"
    echo "  delete    - Delete the entire stack"
    echo "  build     - Build and push Docker image only"
    echo ""
    echo "Environment Variables:"
    echo "  PROJECT_NAME  - Project name (default: gridtokenx)"
    echo "  AWS_REGION    - AWS region (default: us-east-1)"
}

# Main
main() {
    local command="${1:-deploy}"
    
    echo "=========================================="
    echo "  GridTokenX AWS ECS Deployment"
    echo "=========================================="
    echo ""
    
    check_prerequisites
    
    case "$command" in
        deploy)
            build_and_push
            
            # Check if stack exists
            if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" &>/dev/null; then
                deploy_stack "update"
            else
                deploy_stack "create"
            fi
            
            update_service
            get_endpoint
            ;;
        update)
            build_and_push
            update_service
            get_endpoint
            ;;
        status)
            get_endpoint
            ;;
        delete)
            delete_stack
            ;;
        build)
            build_and_push
            ;;
        *)
            usage
            exit 1
            ;;
    esac
    
    echo ""
    log_success "Done!"
}

main "$@"
