#!/bin/bash
# Simple GRX Token Creator using Solana CLI

echo "🚀 Creating GRX Token..."
echo ""

# Create token mint
MINT=$(solana-keygen new --no-bip39-passphrase --silent --outfile /tmp/grx-mint.json)
MINT_ADDRESS=$(solana-keygen pubkey /tmp/grx-mint.json)

echo "✅ Generated mint: $MINT_ADDRESS"
echo ""

# Save the mint info for the wallet manager
cat > grx-token-info.json <<EOF
{
  "name": "GridTokenX",
  "symbol": "GRX",
  "mint": "$MINT_ADDRESS",
  "decimals": 9,
  "createdAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

# Copy keypair
cp /tmp/grx-mint.json grx-mint-keypair.json

echo "✅ Token info saved to grx-token-info.json"
echo "✅ Mint keypair saved to grx-mint-keypair.json"
echo ""
echo "🎉 Setup Complete!"
echo ""
echo "Next steps:"
echo "  1. Mint tokens: ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/Developments/gridtokenx-platform/dev-wallet.json ts-node scripts/grx-wallet-manager.ts mint 1 1000"
echo "  2. Check balances: ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=~/Developments/gridtokenx-platform/dev-wallet.json ts-node scripts/grx-wallet-manager.ts balances"
echo ""
