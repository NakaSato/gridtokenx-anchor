#!/bin/bash
# GridTokenX PoA Cluster Management Script
# Usage: ./poa-cluster.sh [start|stop|status|benchmark|logs]

set -e

COMPOSE_FILE="docker-compose.poa.yml"
PROJECT_NAME="gridtokenx-poa"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Start the PoA cluster
start_cluster() {
    log_info "Starting GridTokenX PoA cluster..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi
    
    # Build and start
    docker-compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" up -d --build
    
    log_info "Waiting for cluster to be ready..."
    sleep 10
    
    # Wait for bootstrap
    for i in $(seq 1 30); do
        if docker exec gridtokenx-bootstrap solana cluster-version -u http://localhost:8899 &>/dev/null; then
            log_info "Bootstrap validator is ready!"
            break
        fi
        echo -n "."
        sleep 2
    done
    echo ""
    
    # Check cluster status
    status_cluster
}

# Stop the PoA cluster
stop_cluster() {
    log_info "Stopping GridTokenX PoA cluster..."
    docker-compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" down
    log_info "Cluster stopped"
}

# Check cluster status
status_cluster() {
    log_info "Checking cluster status..."
    echo ""
    
    # Check each node
    for node in bootstrap validator1 validator2 rpc; do
        container="gridtokenx-${node}"
        if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
            # Get validator info
            if docker exec "$container" solana cluster-version -u http://localhost:8899 &>/dev/null; then
                version=$(docker exec "$container" solana cluster-version -u http://localhost:8899 2>/dev/null)
                echo -e "  ${GREEN}✓${NC} $node: Running (Solana $version)"
            else
                echo -e "  ${YELLOW}○${NC} $node: Starting..."
            fi
        else
            echo -e "  ${RED}✗${NC} $node: Not running"
        fi
    done
    
    echo ""
    
    # Show cluster info
    if docker exec gridtokenx-bootstrap solana cluster-version -u http://localhost:8899 &>/dev/null; then
        log_info "Cluster endpoints:"
        echo "  RPC: http://localhost:8899"
        echo "  WebSocket: ws://localhost:8900"
        echo ""
        
        # Show validator count
        validators=$(docker exec gridtokenx-bootstrap solana validators -u http://localhost:8899 --output json 2>/dev/null | jq '.validators | length' 2>/dev/null || echo "?")
        log_info "Active validators: $validators"
    fi
}

# Run TPC-C benchmark against PoA cluster
run_benchmark() {
    log_info "Running TPC-C benchmark against PoA cluster..."
    
    # Check if cluster is running
    if ! docker exec gridtokenx-bootstrap solana cluster-version -u http://localhost:8899 &>/dev/null; then
        log_error "PoA cluster is not running. Start it first with: ./poa-cluster.sh start"
        exit 1
    fi
    
    # Set RPC URL to PoA cluster
    export ANCHOR_PROVIDER_URL="http://localhost:8899"
    
    # Deploy programs if needed
    log_info "Deploying programs to PoA cluster..."
    anchor deploy --provider.cluster localnet 2>/dev/null || log_warn "Programs may already be deployed"
    
    # Run benchmark
    log_info "Starting TPC-C benchmark..."
    pnpm test:tpc-benchmark
    
    log_info "Benchmark complete!"
}

# Show logs
show_logs() {
    node="${1:-bootstrap}"
    container="gridtokenx-${node}"
    
    log_info "Showing logs for $node..."
    docker logs -f "$container" 2>&1 | head -100
}

# Clean up all data
clean_cluster() {
    log_warn "This will remove all cluster data!"
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker-compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" down -v
        log_info "Cluster data cleaned"
    fi
}

# Main
case "${1:-}" in
    start)
        start_cluster
        ;;
    stop)
        stop_cluster
        ;;
    status)
        status_cluster
        ;;
    benchmark)
        run_benchmark
        ;;
    logs)
        show_logs "${2:-bootstrap}"
        ;;
    clean)
        clean_cluster
        ;;
    *)
        echo "GridTokenX PoA Cluster Manager"
        echo ""
        echo "Usage: $0 <command>"
        echo ""
        echo "Commands:"
        echo "  start      Start the PoA cluster (3 validators + RPC)"
        echo "  stop       Stop the PoA cluster"
        echo "  status     Show cluster status"
        echo "  benchmark  Run TPC-C benchmark against the cluster"
        echo "  logs       Show logs (default: bootstrap)"
        echo "  clean      Remove all cluster data"
        echo ""
        echo "Examples:"
        echo "  $0 start              # Start cluster"
        echo "  $0 benchmark          # Run benchmark"
        echo "  $0 logs validator1    # Show validator1 logs"
        exit 1
        ;;
esac
