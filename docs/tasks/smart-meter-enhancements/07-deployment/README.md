# Deployment Task

## Overview

This task involves deploying all smart meter enhancements to production environments. This includes configuring environments, setting up monitoring, implementing gradual rollout, and establishing rollback procedures. The goal is to ensure a smooth transition from the current manual token minting process to an automated real-time system without disrupting existing operations.

## Objectives

1. Create deployment configurations for different environments
2. Implement gradual rollout strategy with feature flags
3. Set up monitoring and alerting for new components
4. Establish rollback procedures for failed deployments
5. Document deployment process and runbooks
6. Ensure data migration if required

## Technical Requirements

### 1. Environment Configuration

#### Production Environment

Create production environment configuration:

```bash
# .env.production
# Database Configuration
DATABASE_URL=postgresql://prod_user:secure_password@prod-db.example.com:5432/gridtokenx_prod
DATABASE_MAX_CONNECTIONS=20

# Blockchain Configuration
SOLANA_CLUSTER=mainnet-beta
SOLANA_RPC_URL=https://solana-api.projectserum.com
SOLANA_KEYPAIR_PATH=/etc/secrets/solana-keypair.json

# Tokenization Configuration
TOKENIZATION_KWH_TO_TOKEN_RATIO=1.0
TOKENIZATION_DECIMALS=9
TOKENIZATION_MAX_READING_KWH=100.0
TOKENIZATION_READING_MAX_AGE_DAYS=7
TOKENIZATION_AUTO_MINT_ENABLED=false  # Start with disabled for gradual rollout
TOKENIZATION_POLLING_INTERVAL_SECS=300  # Start with 5 minutes
TOKENIZATION_BATCH_SIZE=25  # Start with smaller batch size
TOKENIZATION_MAX_RETRY_ATTEMPTS=3
TOKENIZATION_INITIAL_RETRY_DELAY_SECS=600  # 10 minutes

# Blockchain Service Configuration
BLOCKCHAIN_MAX_BATCH_SIZE=25
BLOCKCHAIN_MAX_TOKENS_PER_TRANSACTION=1000000000000
BLOCKCHAIN_CONCURRENT_BATCHES=3

# WebSocket Service Configuration
WEBSOCKET_MAX_CONNECTIONS=50000
WEBSOCKET_RATE_LIMIT_EVENTS_PER_MINUTE=120
WEBSOCKET_EVENT_BUFFER_SIZE=2000
WEBSOCKET_AUTH_REQUIRED=true
WEBSOCKET_COMPRESSION_ENABLED=true

# Monitoring Configuration
METRICS_ENABLED=true
METRICS_PORT=9090
LOG_LEVEL=info
OTEL_ENDPOINT=https://otel-collector.example.com:4317
OTEL_SERVICE_NAME=gridtokenx-backend
OTEL_SERVICE_VERSION=1.0.0

# Security Configuration
JWT_SECRET=${JWT_SECRET}  # From secrets manager
API_RATE_LIMIT=1000
CORS_ORIGINS=https://gridtokenx.example.com,https://app.gridtokenx.example.com
```

#### Staging Environment

Create staging environment configuration:

```bash
# .env.staging
# Database Configuration
DATABASE_URL=postgresql://staging_user:password@staging-db.example.com:5432/gridtokenx_staging
DATABASE_MAX_CONNECTIONS=10

# Blockchain Configuration
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_KEYPAIR_PATH=/etc/secrets/solana-staging-keypair.json

# Tokenization Configuration
TOKENIZATION_KWH_TO_TOKEN_RATIO=1.0
TOKENIZATION_DECIMALS=9
TOKENIZATION_MAX_READING_KWH=100.0
TOKENIZATION_READING_MAX_AGE_DAYS=7
TOKENIZATION_AUTO_MINT_ENABLED=true  # Enabled in staging for testing
TOKENIZATION_POLLING_INTERVAL_SECS=60
TOKENIZATION_BATCH_SIZE=50
TOKENIZATION_MAX_RETRY_ATTEMPTS=3
TOKENIZATION_INITIAL_RETRY_DELAY_SECS=300

# Blockchain Service Configuration
BLOCKCHAIN_MAX_BATCH_SIZE=50
BLOCKCHAIN_MAX_TOKENS_PER_TRANSACTION=1000000000000
BLOCKCHAIN_CONCURRENT_BATCHES=5

# WebSocket Service Configuration
WEBSOCKET_MAX_CONNECTIONS=1000
WEBSOCKET_RATE_LIMIT_EVENTS_PER_MINUTE=60
WEBSOCKET_EVENT_BUFFER_SIZE=1000
WEBSOCKET_AUTH_REQUIRED=true
WEBSOCKET_COMPRESSION_ENABLED=true

# Monitoring Configuration
METRICS_ENABLED=true
METRICS_PORT=9090
LOG_LEVEL=debug
OTEL_ENDPOINT=https://otel-collector-staging.example.com:4317
OTEL_SERVICE_NAME=gridtokenx-backend-staging
OTEL_SERVICE_VERSION=1.0.0

# Security Configuration
JWT_SECRET=${STAGING_JWT_SECRET}
API_RATE_LIMIT=500
CORS_ORIGINS=https://staging.gridtokenx.example.com,https://app-staging.gridtokenx.example.com
```

### 2. Deployment Scripts

#### Staging Deployment Script

Create `scripts/deploy-staging.sh`:

```bash
#!/bin/bash

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting GridTokenX Smart Meter Enhancements Staging Deployment${NC}"

# Variables
ENVIRONMENT="staging"
IMAGE_TAG="${1:-latest}"
REGISTRY="registry.example.com/gridtokenx"
NAMESPACE="gridtokenx-staging"

# Build Docker image
echo -e "${GREEN}Building Docker image${NC}"
docker build -t ${REGISTRY}/backend:${IMAGE_TAG} .
docker push ${REGISTRY}/backend:${IMAGE_TAG}

# Deploy to Kubernetes
echo -e "${GREEN}Deploying to Kubernetes${NC}"
kubectl set image deployment/backend backend=${REGISTRY}/backend:${IMAGE_TAG} -n ${NAMESPACE}

# Wait for rollout
echo -e "${GREEN}Waiting for deployment rollout${NC}"
kubectl rollout status deployment/backend -n ${NAMESPACE} --timeout=300s

# Run smoke tests
echo -e "${GREEN}Running smoke tests${NC}"
./scripts/smoke-tests.sh ${ENVIRONMENT}

echo -e "${GREEN}Staging deployment completed successfully${NC}"
```

#### Production Deployment Script

Create `scripts/deploy-prod.sh`:

```bash
#!/bin/bash

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting GridTokenX Smart Meter Enhancements Production Deployment${NC}"

# Variables
ENVIRONMENT="production"
IMAGE_TAG="${1:-latest}"
REGISTRY="registry.example.com/gridtokenx"
NAMESPACE="gridtokenx-prod"

# Build Docker image
echo -e "${GREEN}Building Docker image${NC}"
docker build -t ${REGISTRY}/backend:${IMAGE_TAG} .
docker push ${REGISTRY}/backend:${IMAGE_TAG}

# Create backup of current deployment
echo -e "${GREEN}Creating backup of current deployment${NC}"
kubectl get deployment backend -n ${NAMESPACE} -o yaml > deployment-backup-$(date +%Y%m%d-%H%M%S).yaml

# Deploy to Kubernetes with gradual rollout
echo -e "${GREEN}Deploying to Kubernetes${NC}"
kubectl set image deployment/backend backend=${REGISTRY}/backend:${IMAGE_TAG} -n ${NAMESPACE}

# Wait for initial rollout
echo -e "${GREEN}Waiting for initial deployment${NC}"
kubectl rollout status deployment/backend -n ${NAMESPACE} --timeout=600s

# Enable auto-mint for small percentage of users
echo -e "${GREEN}Enabling auto-mint for 5% of users${NC}"
# This would use feature flags or configuration management
kubectl patch deployment backend -n ${NAMESPACE} -p '{"spec":{"template":{"spec":{"containers":[{"name":"backend","env":[{"name":"TOKENIZATION_AUTO_MINT_ENABLED","value":"true"},{"name":"TOKENIZATION_AUTO_MINT_PERCENTAGE","value":"5"}]}]}}}'

# Wait for rollout with new configuration
echo -e "${GREEN}Waiting for rollout with new configuration${NC}"
kubectl rollout status deployment/backend -n ${NAMESPACE} --timeout=300s

# Run smoke tests
echo -e "${GREEN}Running smoke tests${NC}"
./scripts/smoke-tests.sh ${ENVIRONMENT}

# Monitor for 10 minutes before proceeding
echo -e "${YELLOW}Monitoring for 10 minutes before increasing rollout${NC}"
./scripts/monitor-deployment.sh ${ENVIRONMENT} 600

# Increase auto-mint to 20% of users
echo -e "${GREEN}Increasing auto-mint to 20% of users${NC}"
kubectl patch deployment backend -n ${NAMESPACE} -p '{"spec":{"template":{"spec":{"containers":[{"name":"backend","env":[{"name":"TOKENIZATION_AUTO_MINT_PERCENTAGE","value":"20"}]}}}'

# Wait for rollout with new configuration
echo -e "${GREEN}Waiting for rollout with new configuration${NC}"
kubectl rollout status deployment/backend -n ${NAMESPACE} --timeout=300s

# Monitor for 30 minutes before proceeding
echo -e "${YELLOW}Monitoring for 30 minutes before increasing rollout${NC}"
./scripts/monitor-deployment.sh ${ENVIRONMENT} 1800

# Enable auto-mint for all users
echo -e "${GREEN}Enabling auto-mint for all users${NC}"
kubectl patch deployment backend -n ${NAMESPACE} -p '{"spec":{"template":{"spec":{"containers":[{"name":"backend","env":[{"name":"TOKENIZATION_AUTO_MINT_ENABLED","value":"true"}]}}}'

# Wait for final rollout
echo -e "${GREEN}Waiting for final rollout${NC}"
kubectl rollout status deployment/backend -n ${NAMESPACE} --timeout=600s

echo -e "${GREEN}Production deployment completed successfully${NC}"
```

### 3. Kubernetes Manifests

#### Production Deployment Manifest

Create `k8s/production/backend-deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: gridtokenx-prod
  labels:
    app: gridtokenx
    component: backend
    version: v1
spec:
  replicas: 6
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 2
      maxUnavailable: 2
  selector:
    matchLabels:
      app: gridtokenx
      component: backend
  template:
    metadata:
      labels:
        app: gridtokenx
        component: backend
        version: v1
    spec:
      containers:
      - name: backend
        image: registry.example.com/gridtokenx/backend:latest
        ports:
        - containerPort: 8080
          name: http
        - containerPort: 9090
          name: metrics
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: url
        - name: SOLANA_KEYPAIR
          valueFrom:
            secretKeyRef:
              name: solana-secrets
              key: keypair
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: jwt-secrets
              key: secret
        - name: TOKENIZATION_KWH_TO_TOKEN_RATIO
          value: "1.0"
        - name: TOKENIZATION_DECIMALS
          value: "9"
        - name: TOKENIZATION_MAX_READING_KWH
          value: "100.0"
        - name: TOKENIZATION_READING_MAX_AGE_DAYS
          value: "7"
        - name: TOKENIZATION_AUTO_MINT_ENABLED
          value: "false"
        - name: TOKENIZATION_POLLING_INTERVAL_SECS
          value: "300"
        - name: TOKENIZATION_BATCH_SIZE
          value: "25"
        - name: BLOCKCHAIN_MAX_BATCH_SIZE
          value: "25"
        - name: BLOCKCHAIN_CONCURRENT_BATCHES
          value: "3"
        - name: WEBSOCKET_MAX_CONNECTIONS
          value: "50000"
        - name: METRICS_ENABLED
          value: "true"
        - name: LOG_LEVEL
          value: "info"
        resources:
          requests:
            cpu: 1000m
            memory: 2Gi
          limits:
            cpu: 2000m
            memory: 4Gi
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
        volumeMounts:
        - name: config-volume
          mountPath: /app/config
        - name: secrets-volume
          mountPath: /app/secrets
      volumes:
      - name: config-volume
        configMap:
          name: backend-config
      - name: secrets-volume
        secret:
          secretName: backend-secrets
      terminationGracePeriodSeconds: 60
---
apiVersion: v1
kind: Service
metadata:
  name: backend-service
  namespace: gridtokenx-prod
spec:
  selector:
    app: gridtokenx
    component: backend
  ports:
  - name: http
    port: 80
    targetPort: 8080
  - name: metrics
    port: 9090
    targetPort: 9090
  type: ClusterIP
---
apiVersion: v1
kind: ServiceMonitor
metadata:
  name: backend-metrics
  namespace: gridtokenx-prod
  labels:
    app: gridtokenx
    component: backend
spec:
  selector:
    matchLabels:
      app: gridtokenx
      component: backend
  endpoints:
  - port: metrics
    interval: 30s
    path: /metrics
```

### 4. Monitoring and Alerting

#### Prometheus Configuration

Create `monitoring/prometheus-rules.yaml`:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: gridtokenx-backend
  namespace: gridtokenx-prod
spec:
  groups:
  - name: gridtokenx.rules
    rules:
    - alert: HighErrorRate
      expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "High error rate detected"
        description: "Error rate is {{ $value | humanizePercentage }} for the last 5 minutes"
    
    - alert: MeterPollingServiceDown
      expr: up{job="gridtokenx-backend",instance=~".*"} == 0
      for: 2m
      labels:
        severity: critical
      annotations:
        summary: "Meter polling service is down"
        description: "The meter polling service has been down for more than 2 minutes"
    
    - alert: HighUnmintedReadingsBacklog
      expr: gridtokenx_unminted_readings_count > 1000
      for: 15m
      labels:
        severity: warning
      annotations:
        summary: "High backlog of unminted readings"
        description: "There are {{ $value }} unminted readings, which is above the threshold"
    
    - alert: TokenMintingFailures
      expr: rate(gridtokenx_token_minting_failures_total[5m]) > 0.1
      for: 10m
      labels:
        severity: warning
      annotations:
        summary: "High token minting failure rate"
        description: "Token minting failure rate is {{ $value | humanizePercentage }} for the last 5 minutes"
    
    - alert: WebSocketConnectionIssues
      expr: rate(gridtokenx_websocket_errors_total[5m]) / rate(gridtokenx_websocket_connections_total[5m]) > 0.05
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "High WebSocket error rate"
        description: "WebSocket error rate is {{ $value | humanizePercentage }} for the last 5 minutes"
    
    - alert: HighMemoryUsage
      expr: (container_memory_usage_bytes{name="backend"} / container_spec_memory_limit_bytes{name="backend"}) > 0.9
      for: 5m
      labels:
        severity: warning
      annotations:
        summary: "High memory usage"
        description: "Memory usage is {{ $value | humanizePercentage }} of the limit"
    
    - alert: HighCPUUsage
      expr: rate(container_cpu_usage_seconds_total{name="backend"}[5m]) / container_spec_cpu_quota{name="backend"} > 0.8
      for: 10m
      labels:
        severity: warning
      annotations:
        summary: "High CPU usage"
        description: "CPU usage is {{ $value | humanizePercentage }} of the limit"
```

#### Grafana Dashboard

Create `monitoring/grafana-dashboard.json` for smart meter monitoring:

```json
{
  "dashboard": {
    "title": "GridTokenX Smart Meter Monitoring",
    "panels": [
      {
        "title": "Meter Readings Processed",
        "type": "stat",
        "targets": [
          {
            "expr": "sum(rate(gridtokenx_meter_readings_processed_total[5m])) * 60",
            "legendFormat": "Readings per minute"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "reqps"
          }
        }
      },
      {
        "title": "Tokens Minted",
        "type": "stat",
        "targets": [
          {
            "expr": "sum(rate(gridtokenx_tokens_minted_total[5m])) * 60",
            "legendFormat": "Tokens per minute"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "short"
          }
        }
      },
      {
        "title": "Unminted Readings Backlog",
        "type": "stat",
        "targets": [
          {
            "expr": "gridtokenx_unminted_readings_count",
            "legendFormat": "Unminted readings"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "short",
            "thresholds": {
              "steps": [
                {"color": "green", "value": 0},
                {"color": "yellow", "value": 500},
                {"color": "red", "value": 1000}
              ]
            }
          }
        }
      },
      {
        "title": "Token Minting Success Rate",
        "type": "stat",
        "targets": [
          {
            "expr": "rate(gridtokenx_token_minting_successes_total[5m]) / (rate(gridtokenx_token_minting_successes_total[5m]) + rate(gridtokenx_token_minting_failures_total[5m]))",
            "legendFormat": "Success rate"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "percentunit",
            "max": 1,
            "min": 0,
            "thresholds": {
              "steps": [
                {"color": "red", "value": 0},
                {"color": "yellow", "value": 0.9},
                {"color": "green", "value": 0.99}
              ]
            }
          }
        }
      },
      {
        "title": "WebSocket Connections",
        "type": "stat",
        "targets": [
          {
            "expr": "gridtokenx_websocket_connections_active",
            "legendFormat": "Active connections"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "short"
          }
        }
      },
      {
        "title": "Meter Readings Timeline",
        "type": "timeseries",
        "targets": [
          {
            "expr": "rate(gridtokenx_meter_readings_processed_total[5m])",
            "legendFormat": "Processing rate"
          },
          {
            "expr": "rate(gridtokenx_meter_readings_received_total[5m])",
            "legendFormat": "Submission rate"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "reqps"
          }
        }
      },
      {
        "title": "Token Minting Timeline",
        "type": "timeseries",
        "targets": [
          {
            "expr": "rate(gridtokenx_tokens_minted_total[5m])",
            "legendFormat": "Minting rate"
          },
          {
            "expr": "rate(gridtokenx_token_minting_failures_total[5m])",
            "legendFormat": "Failure rate"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "reqps"
          }
        }
      },
      {
        "title": "Batch Processing Metrics",
        "type": "table",
        "targets": [
          {
            "expr": "gridtokenx_batch_processing_duration_seconds",
            "legendFormat": "{{ instance }}",
            "format": "table"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "s"
          }
        }
      }
    ],
    "time": {
      "from": "now-1h",
      "to": "now"
    },
    "refresh": "30s"
  }
}
```

### 5. Smoke Tests

Create `scripts/smoke-tests.sh`:

```bash
#!/bin/bash

set -e

ENVIRONMENT=${1:-staging}

echo "Running smoke tests for ${ENVIRONMENT} environment"

# Determine base URL based on environment
if [ "${ENVIRONMENT}" = "production" ]; then
  BASE_URL="https://api.gridtokenx.example.com"
else
  BASE_URL="https://staging-api.gridtokenx.example.com"
fi

# Test health endpoint
echo "Testing health endpoint"
curl -f -s "${BASE_URL}/health" | jq .

# Test ready endpoint
echo "Testing ready endpoint"
curl -f -s "${BASE_URL}/ready" | jq .

# Test meter reading submission
echo "Testing meter reading submission"
READING_RESPONSE=$(curl -f -s -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${STAGING_API_TOKEN}" \
  -d '{
    "wallet_address": "5C4wSuGVU2J5qmM4gR1gM7YJQ2dEjKowZ3zLsjhZxKq9",
    "meter_id": "SMOKE_TEST_METER",
    "kwh_amount": 10.5,
    "reading_timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "meter_signature": "smoke_test_signature"
  }' \
  "${BASE_URL}/api/meters/submit-reading")

echo "Reading submission response: ${READING_RESPONSE}"

# Check if reading was accepted
if echo "${READING_RESPONSE}" | jq -e '.success' > /dev/null; then
  echo "✅ Meter reading submission successful"
else
  echo "❌ Meter reading submission failed"
  exit 1
fi

# Test WebSocket connection (simple echo test)
echo "Testing WebSocket connection"
WS_URL=$(echo "${BASE_URL}" | sed 's/http/ws/g' | sed 's:/:/:/g')
WS_RESPONSE=$(timeout 10 wscat -x "{\"type\":\"ping\"}" -c "${WS_URL}/ws")

if echo "${WS_RESPONSE}" | grep -q "pong"; then
  echo "✅ WebSocket connection successful"
else
  echo "❌ WebSocket connection failed"
  exit 1
fi

# Test admin endpoint (if in staging)
if [ "${ENVIRONMENT}" = "staging" ]; then
  echo "Testing admin endpoint"
  STATUS_RESPONSE=$(curl -f -s -H "Authorization: Bearer ${STAGING_API_TOKEN}" "${BASE_URL}/api/admin/tokenization/status")
  
  echo "Tokenization status: ${STATUS_RESPONSE}"
  
  if echo "${STATUS_RESPONSE}" | jq -e '.auto_mint_enabled' > /dev/null; then
    echo "✅ Admin endpoint working"
  else
    echo "❌ Admin endpoint not working"
    exit 1
  fi
fi

echo "All smoke tests passed!"
```

### 6. Deployment Monitoring Script

Create `scripts/monitor-deployment.sh`:

```bash
#!/bin/bash

ENVIRONMENT=${1:-staging}
DURATION=${2:-300}  # Default 5 minutes

echo "Monitoring deployment to ${ENVIRONMENT} for ${DURATION} seconds"

# Determine base URL based on environment
if [ "${ENVIRONMENT}" = "production" ]; then
  BASE_URL="https://api.gridtokenx.example.com"
else
  BASE_URL="https://staging-api.gridtokenx.example.com"
fi

# Start monitoring
END_TIME=$((SECONDS + DURATION))

while [ $SECONDS -lt $END_TIME ]; do
  # Check health endpoint
  if ! curl -f -s "${BASE_URL}/health" > /dev/null; then
    echo "❌ Health check failed!"
    exit 1
  fi
  
  # Check error rate (if metrics endpoint is available)
  ERROR_RATE=$(curl -s "${BASE_URL}/metrics" | grep "http_requests_total.*status=\"5\"" | awk '{print $NF}')
  if [ -n "${ERROR_RATE}" ] && [ "${ERROR_RATE}" -gt 10 ]; then
    echo "❌ High error rate detected: ${ERROR_RATE}"
    exit 1
  fi
  
  # Print status
  echo "✅ Deployment healthy (${SECONDS}/${DURATION}s elapsed)"
  
  sleep 10
done

echo "✅ Deployment monitoring complete - no issues detected"
```

## Implementation Steps

1. Create environment-specific configuration files
2. Develop deployment scripts for staging and production
3. Create Kubernetes manifests for all environments
4. Set up monitoring and alerting for new components
5. Implement smoke tests for all environments
6. Create deployment monitoring script
7. Implement gradual rollout strategy
8. Create rollback procedures
9. Document runbooks for common issues
10. Train operations team on new components

## Rollback Procedures

### Automatic Rollback

Create `scripts/rollback.sh`:

```bash
#!/bin/bash

ENVIRONMENT=${1:-staging}

echo "Rolling back deployment to ${ENVIRONMENT}"

# Determine namespace based on environment
if [ "${ENVIRONMENT}" = "production" ]; then
  NAMESPACE="gridtokenx-prod"
else
  NAMESPACE="gridtokenx-staging"
fi

# Get the previous revision
PREVIOUS_REVISION=$(kubectl rollout history deployment/backend -n ${NAMESPACE} | grep "2" | awk '{print $1}')

# Rollback to the previous revision
kubectl rollout undo deployment/backend -n ${NAMESPACE} --to-revision=${PREVIOUS_REVISION}

# Wait for rollout to complete
kubectl rollout status deployment/backend -n ${NAMESPACE} --timeout=600s

echo "Rollback completed successfully"
```

### Manual Rollback Runbook

1. **Identify the issue**
   - Check monitoring dashboards for errors
   - Review application logs
   - Identify when the issue started

2. **Determine the scope**
   - Is it affecting all users or a subset?
   - Is it related to auto-minting or other components?
   - Is it critical or non-critical functionality?

3. **Immediate mitigation**
   - If auto-minting is causing issues, disable it:
     ```bash
     kubectl patch deployment backend -n gridtokenx-prod -p '{"spec":{"template":{"spec":{"containers":[{"name":"backend","env":[{"name":"TOKENIZATION_AUTO_MINT_ENABLED","value":"false"}]}}}'
     ```
   - If WebSocket issues, disable new connections:
     ```bash
     kubectl patch deployment backend -n gridtokenx-prod -p '{"spec":{"template":{"spec":{"containers":[{"name":"backend","env":[{"name":"WEBSOCKET_MAX_CONNECTIONS","value":"0"}]}}}'
     ```

4. **Rollback decision**
   - For critical issues, use the rollback script:
     ```bash
     ./scripts/rollback.sh production
     ```
   - For non-critical issues, consider a hotfix

5. **Post-rollback verification**
   - Run smoke tests
   - Monitor metrics for improvement
   - Verify functionality is restored

6. **Post-mortem**
   - Document the issue
   - Identify root cause
   - Create action items to prevent recurrence

## Environment Variables

Add the following to production environment:

```bash
# Feature flags for gradual rollout
TOKENIZATION_AUTO_MINT_ENABLED=false
TOKENIZATION_AUTO_MINT_PERCENTAGE=0
TOKENIZATION_WEBHOOK_EVENTS_ENABLED=false

# Monitoring and alerting
SENTRY_DSN=${SENTRY_DSN}
PROMETHEUS_ENDPOINT=https://prometheus.example.com
GRAFANA_DASHBOARD_URL=https://grafana.example.com

# Rollback configuration
ROLLBACK_ENABLED=true
ROLLBACK_THRESHOLD_ERROR_RATE=0.1
ROLLBACK_THRESHOLD_LATENCY=5000
```

## Acceptance Criteria

1. Deployment scripts work correctly for all environments
2. Monitoring captures all critical metrics for smart meter enhancements
3. Alerting rules trigger for significant issues
4. Gradual rollout strategy allows for safe deployment
5. Rollback procedures restore system to a stable state
6. Smoke tests verify basic functionality after deployment
7. Documentation covers all aspects of deployment and operations
8. Runbooks provide clear steps for handling common issues
9. Operations team is trained on new components
10. System meets performance targets in production environment