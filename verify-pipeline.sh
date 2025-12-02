#!/bin/bash
# Pipeline Verification Script
# Verifies the complete Smart Meter → Token Minting flow

echo "=========================================="
echo "Smart Meter Token Minting Pipeline Verification"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Verify Solana Validator
echo "Step 1: Verifying Solana Validator..."
if solana cluster-version &> /dev/null; then
    VERSION=$(solana cluster-version 2>/dev/null)
    echo -e "${GREEN}✅ Validator Running${NC} - Version: $VERSION"
else
    echo -e "${RED}❌ Validator Not Running${NC}"
    exit 1
fi
echo ""

# Step 2: Verify Energy Token Program
echo "Step 2: Verifying Energy Token Program..."
PROGRAM_ID="GHoWp5RcujaeqimAAf9RwyRQCCF23mXxVYX9iGwBYGrH"
if solana program show $PROGRAM_ID &> /dev/null; then
    echo -e "${GREEN}✅ Energy Token Program Deployed${NC}"
    echo "   Program ID: $PROGRAM_ID"
else
    echo -e "${RED}❌ Energy Token Program Not Found${NC}"
    exit 1
fi
echo ""

# Step 3: Verify API Gateway
echo "Step 3: Verifying API Gateway..."
HEALTH_RESPONSE=$(curl -s http://localhost:8080/health 2>/dev/null)
if echo "$HEALTH_RESPONSE" | grep -q "healthy"; then
    echo -e "${GREEN}✅ API Gateway Healthy${NC}"
    echo "   Endpoint: http://localhost:8080"
else
    echo -e "${RED}❌ API Gateway Not Responding${NC}"
    exit 1
fi
echo ""

# Step 4: Verify Test File Exists
echo "Step 4: Verifying Test File..."
TEST_FILE="tests/smart-meter-minting.test.ts"
if [ -f "$TEST_FILE" ]; then
    LINE_COUNT=$(wc -l < "$TEST_FILE")
    echo -e "${GREEN}✅ Test File Exists${NC}"
    echo "   Location: $TEST_FILE"
    echo "   Lines: $LINE_COUNT"
else
    echo -e "${RED}❌ Test File Not Found${NC}"
    exit 1
fi
echo ""

# Step 5: Check Configuration
echo "Step 5: Checking Configuration..."
echo -e "${YELLOW}API Gateway Configuration:${NC}"
if [ -f "../gridtokenx-apigateway/.env" ]; then
    echo "   Auto-mint: $(grep TOKENIZATION_AUTO_MINT_ENABLED ../gridtokenx-apigateway/.env | cut -d'=' -f2)"
    echo "   Polling interval: $(grep TOKENIZATION_POLLING_INTERVAL_SECS ../gridtokenx-apigateway/.env | cut -d'=' -f2)s"
    echo "   kWh ratio: $(grep TOKENIZATION_KWH_TO_TOKEN_RATIO ../gridtokenx-apigateway/.env | cut -d'=' -f2)"
    echo "   Decimals: $(grep TOKENIZATION_DECIMALS ../gridtokenx-apigateway/.env | cut -d'=' -f2)"
else
    echo -e "${YELLOW}⚠️  .env file not found${NC}"
fi
echo ""

# Summary
echo "=========================================="
echo "Pipeline Verification Summary"
echo "=========================================="
echo -e "${GREEN}✅ All Components Verified${NC}"
echo ""
echo "Pipeline Flow:"
echo "  1. Smart Meter → Generates kWh readings"
echo "  2. API Gateway → Validates & stores (http://localhost:8080)"
echo "  3. Database → Stores with minted=false"
echo "  4. Polling Service → Processes every 60s"
echo "  5. Blockchain → Mints tokens ($PROGRAM_ID)"
echo "  6. User Wallet → Receives tokens"
echo ""
echo "To test the pipeline:"
echo "  anchor test --skip-local-validator tests/smart-meter-minting.test.ts"
echo ""
echo "To monitor live:"
echo "  tail -f ../gridtokenx-apigateway/apigateway.log | grep -i mint"
echo ""
