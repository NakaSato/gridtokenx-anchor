#!/bin/bash

# Script to fund the authority wallet with periodic retries
# Usage: ./fund-authority.sh

AUTHORITY_WALLET="AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3"
AMOUNT=10
MAX_RETRIES=20
RETRY_INTERVAL=30  # seconds

echo "🔄 Authority Wallet Funding Script"
echo "Wallet: $AUTHORITY_WALLET"
echo "Amount: $AMOUNT SOL"
echo "Max retries: $MAX_RETRIES"
echo "Retry interval: ${RETRY_INTERVAL}s"
echo ""

# Ensure we're using localhost
solana config set --url localhost > /dev/null 2>&1

for i in $(seq 1 $MAX_RETRIES); do
    echo "[$i/$MAX_RETRIES] Checking balance..."
    
    # Check current balance
    BALANCE=$(solana balance $AUTHORITY_WALLET 2>/dev/null | awk '{print $1}')
    
    if [ ! -z "$BALANCE" ] && [ "$BALANCE" != "0" ]; then
        echo "✅ Success! Authority wallet funded with $BALANCE SOL"
        exit 0
    fi
    
    echo "[$i/$MAX_RETRIES] Balance is 0 SOL. Requesting airdrop..."
    
    # Try airdrop with timeout
    timeout 25s solana airdrop $AMOUNT $AUTHORITY_WALLET 2>&1 | grep -v "Finalizing"
    
    # Check if it succeeded
    sleep 2
    BALANCE=$(solana balance $AUTHORITY_WALLET 2>/dev/null | awk '{print $1}')
    
    if [ ! -z "$BALANCE" ] && [ "$BALANCE" != "0" ]; then
        echo "✅ Success! Authority wallet funded with $BALANCE SOL"
        exit 0
    fi
    
    if [ $i -lt $MAX_RETRIES ]; then
        echo "⏳ Waiting ${RETRY_INTERVAL}s before retry..."
        sleep $RETRY_INTERVAL
    fi
done

echo "❌ Failed to fund authority wallet after $MAX_RETRIES attempts"
echo ""
echo "Alternative options:"
echo "1. Wait longer and try again"
echo "2. Use devnet: solana config set --url devnet && solana airdrop 2 $AUTHORITY_WALLET"
echo "3. Manual transfer from another wallet"
echo "4. Restart validator: ./start-validator.sh"
exit 1
