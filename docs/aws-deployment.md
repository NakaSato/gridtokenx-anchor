# AWS ECS Deployment Guide

Deploy GridTokenX Solana blockchain to AWS ECS (Fargate) for research and testing.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                          AWS VPC                            │
│  ┌────────────────────┐    ┌────────────────────┐          │
│  │   Public Subnet 1  │    │   Public Subnet 2  │          │
│  │   (AZ-a)           │    │   (AZ-b)           │          │
│  └────────────────────┘    └────────────────────┘          │
│           │                         │                       │
│           └─────────┬───────────────┘                       │
│                     ▼                                       │
│            ┌────────────────┐                               │
│            │  ECS Cluster   │                               │
│            │  (Fargate)     │                               │
│            │                │                               │
│            │ ┌────────────┐ │                               │
│            │ │  Solana    │ │  ◄── 8899 (RPC)              │
│            │ │ Validator  │ │  ◄── 8900 (PubSub)           │
│            │ │  Container │ │  ◄── 9900 (Faucet)           │
│            │ └────────────┘ │                               │
│            └────────────────┘                               │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

1. **AWS CLI** installed and configured
   ```bash
   aws configure
   ```

2. **Docker** installed and running

3. **IAM Permissions** for:
   - ECS (create/manage clusters, services, tasks)
   - ECR (create/push repositories)
   - CloudFormation (create/manage stacks)
   - VPC (create network resources)
   - IAM (create roles)

## Quick Deploy

```bash
cd aws
./deploy.sh deploy
```

This will:
1. Build Docker image
2. Push to ECR
3. Create CloudFormation stack
4. Deploy ECS service
5. Output the RPC endpoint

## Manual Deployment

### Step 1: Build and Push Image

```bash
# Build the Docker image
docker build -t gridtokenx-solana:latest .

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Create repository (first time only)
aws ecr create-repository --repository-name gridtokenx-solana

# Tag and push
docker tag gridtokenx-solana:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/gridtokenx-solana:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/gridtokenx-solana:latest
```

### Step 2: Deploy Infrastructure

```bash
aws cloudformation create-stack \
  --stack-name gridtokenx-infrastructure \
  --template-body file://aws/cloudformation.yaml \
  --parameters ParameterKey=ProjectName,ParameterValue=gridtokenx \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1
```

### Step 3: Wait for Deployment

```bash
aws cloudformation wait stack-create-complete \
  --stack-name gridtokenx-infrastructure \
  --region us-east-1
```

## Configuration

### Instance Sizing (Fargate)

| Size | CPU | Memory | Cost/hour | Use Case |
|------|-----|--------|-----------|----------|
| Small | 1 vCPU | 2GB | ~$0.02 | Development |
| **Medium** | 2 vCPU | 4GB | ~$0.04 | **Research (Default)** |
| Large | 4 vCPU | 8GB | ~$0.08 | Load testing |

To change size, modify `ContainerCpu` and `ContainerMemory` in CloudFormation:

```yaml
Parameters:
  ContainerCpu:
    Default: 4096  # 4 vCPU
  ContainerMemory:
    Default: 8192  # 8 GB
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RUST_LOG` | `info` | Logging level |
| `LEDGER_DIR` | `/data/ledger` | Ledger storage path |
| `RPC_PORT` | `8899` | JSON-RPC port |

## Operations

### Check Service Status

```bash
./deploy.sh status
```

### Update Deployment

```bash
./deploy.sh update
```

### View Logs

```bash
aws logs tail /ecs/gridtokenx-solana --follow
```

### Execute Command in Container

```bash
aws ecs execute-command \
  --cluster gridtokenx-cluster \
  --task <task-id> \
  --container solana-validator \
  --interactive \
  --command "/bin/bash"
```

### Delete Stack

```bash
./deploy.sh delete
```

## Cost Optimization

### Use Fargate Spot

CloudFormation already includes Spot capacity provider. For cost savings:

```yaml
DefaultCapacityProviderStrategy:
  - CapacityProvider: FARGATE_SPOT
    Weight: 1
```

**Savings: Up to 70% off standard Fargate pricing**

### Auto-Stop Schedule

Add EventBridge rule to stop service outside business hours:

```bash
# Stop at 8 PM
aws events put-rule --name stop-gridtokenx \
  --schedule-expression "cron(0 20 * * ? *)"

# Start at 8 AM
aws events put-rule --name start-gridtokenx \
  --schedule-expression "cron(0 8 * * ? *)"
```

## Monitoring

### CloudWatch Metrics

- ECS Service CPU/Memory utilization
- Container health check status
- Network I/O

### CloudWatch Logs

All container logs are automatically sent to:
```
/ecs/gridtokenx-solana
```

## Troubleshooting

### Task Not Starting

```bash
# Check task status
aws ecs describe-tasks \
  --cluster gridtokenx-cluster \
  --tasks $(aws ecs list-tasks --cluster gridtokenx-cluster --query 'taskArns[0]' --output text)

# Common issues:
# - Image not found: Check ECR repository
# - No capacity: Check Fargate availability
# - Health check failing: Increase startPeriod
```

### Cannot Connect to RPC

1. Check security group allows inbound on port 8899
2. Verify task has public IP assigned
3. Test health endpoint first:
   ```bash
   curl http://<ip>:8899 -X POST -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
   ```

### High Latency

- Consider moving to a region closer to users
- Upgrade to larger instance size
- Check CloudWatch metrics for resource constraints

## Security Considerations

> [!WARNING]
> The default configuration exposes RPC ports publicly. For production:
> - Restrict security group to specific IPs
> - Use VPN or PrivateLink
> - Enable WAF for API protection
