#!/bin/bash
# Mint GRX tokens to wallets using SPL Token CLI

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🪙 GRX Token Minting Script${NC}"
echo ""

# Check arguments
if [ "$#" -lt 2 ]; then
    echo "Usage: ./scripts/mint-grx.sh <wallet_number> <amount>"
    echo "Example: ./scripts/mint-grx.sh 1 1000"
    echo ""
    echo "Available wallets:"
    echo "  1 - Wallet 1 ($(solana-keygen pubkey wallet-1-keypair.json 2>/dev/null || echo 'Not found'))"
    echo "  2 - Wallet 2 ($(solana-keygen pubkey wallet-2-keypair.json 2>/dev/null || echo 'Not found'))"
    exit 1
fi

WALLET_NUM=$1
AMOUNT=$2

# Load mint address
MINT_ADDRESS=$(jq -r '.mint' grx-token-info.json)
echo -e "${GREEN}✅ Mint:${NC} $MINT_ADDRESS"

# Get wallet address
if [ "$WALLET_NUM" = "1" ]; then
    WALLET_ADDRESS=$(solana-keygen pubkey wallet-1-keypair.json)
    echo -e "${GREEN}✅ Target:${NC} Wallet 1 - $WALLET_ADDRESS"
elif [ "$WALLET_NUM" = "2" ]; then
    WALLET_ADDRESS=$(solana-keygen pubkey wallet-2-keypair.json)
    echo -e "${GREEN}✅ Target:${NC} Wallet 2 - $WALLET_ADDRESS"
else
    echo -e "${YELLOW}❌ Invalid wallet number. Use 1 or 2${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}🔨 Minting $AMOUNT GRX tokens...${NC}"
echo ""

# Create mint if needed (using Token-2022)
spl-token create-token --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb grx-mint-keypair.json 2>/dev/null || echo "Mint already exists"

# Create associated token account for wallet if needed
echo "Creating token account if needed..."
spl-token create-account $MINT_ADDRESS --owner $WALLET_ADDRESS --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb --fee-payer ~/Developments/gridtokenx-platform/dev-wallet.json 2>/dev/null || true

# Get the token account address
TOKEN_ACCOUNT=$(spl-token accounts $MINT_ADDRESS --owner $WALLET_ADDRESS --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb --output json 2>/dev/null | jq -r '.[0].address' 2>/dev/null)

if [ -z "$TOKEN_ACCOUNT" ] || [ "$TOKEN_ACCOUNT" = "null" ]; then
    echo "Error: Could not find token account"
    exit 1
fi

echo "Token account: $TOKEN_ACCOUNT"

# Mint tokens
echo "Minting tokens..."
spl-token mint $MINT_ADDRESS $AMOUNT $TOKEN_ACCOUNT --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb --fee-payer ~/Developments/gridtokenx-platform/dev-wallet.json

echo ""
echo -e "${GREEN}✅ Minting successful!${NC}"
echo -e "${GREEN}   Amount:${NC} $AMOUNT GRX"
echo -e "${GREEN}   To:${NC} $WALLET_ADDRESS"
echo ""

# Show balance
echo -e "${BLUE}📊 Current balance:${NC}"
spl-token balance $MINT_ADDRESS --owner $WALLET_ADDRESS --program-id TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
echo ""
echo "Check all balances: ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/Developments/gridtokenx-platform/dev-wallet.json ts-node scripts/grx-wallet-manager.ts balances"
