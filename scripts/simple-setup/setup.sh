#!/usr/bin/env bash
# Simple Setup Script for GridTokenX Project

set -e  # Exit on error

echo "🚀 GridTokenX Simple Setup"
echo "================================"

# 1. Start local validator
echo "Starting local validator..."
solana-test-validator --reset --rpc-port 8999 --quiet --faucet-sol 10000000000 &
VALIDATOR_PID=$!
echo "Validator PID: $VALIDATOR_PID"

# Wait for validator to start
sleep 5

# 2. Create GRX token mint
echo "Creating GRX token mint..."
solana-keygen new --no-bip39-passphrase --silent --outfile ./grx-mint-keypair.json
MINT_PUBKEY=$(solana-keygen pubkey ./grx-mint-keypair.json)
echo "Mint public key: $MINT_PUBKEY"

# Create token
spl-token create-token ./grx-mint-keypair.json --decimals 9
TOKEN_ADDRESS=$(spl-token address --mint-authority ~/.config/solana/id.json)
echo "Token address: $TOKEN_ADDRESS"

# 3. Create test wallets
echo "Creating test wallets..."
solana-keygen new --no-bip39-passphrase --silent --outfile ./wallet-1-keypair.json
WALLET1_PUBKEY=$(solana-keygen pubkey ./wallet-1-keypair.json)
echo "Wallet 1 public key: $WALLET1_PUBKEY"

solana-keygen new --no-bip39-passphrase --silent --outfile ./wallet-2-keypair.json
WALLET2_PUBKEY=$(solana-keygen pubkey ./wallet-2-keypair.json)
echo "Wallet 2 public key: $WALLET2_PUBKEY"

# 4. Create token accounts
echo "Creating token accounts..."
spl-token create-account $TOKEN_ADDRESS --owner $WALLET1_PUBKEY
ACCOUNT1_ADDRESS=$(spl-token address --mint-authority $WALLET1_PUBKEY --token $TOKEN_ADDRESS)
echo "Account 1 address: $ACCOUNT1_ADDRESS"

spl-token create-account $TOKEN_ADDRESS --owner $WALLET2_PUBKEY
ACCOUNT2_ADDRESS=$(spl-token address --mint-authority $WALLET2_PUBKEY --token $TOKEN_ADDRESS)
echo "Account 2 address: $ACCOUNT2_ADDRESS"

# 5. Mint tokens to accounts
echo "Minting 1000 tokens to each wallet..."
spl-token mint $TOKEN_ADDRESS 1000 $ACCOUNT1_ADDRESS
spl-token mint $TOKEN_ADDRESS 1000 $ACCOUNT2_ADDRESS

# 6. Save token info
cat > grx-token-info.json << EOF
{
  "name": "GridTokenX",
  "symbol": "GRX",
  "mint": "$TOKEN_ADDRESS",
  "decimals": 9,
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
}
EOF

# 7. Display summary
echo ""
echo "✅ Setup Complete!"
echo "================================"
echo "Validator PID: $VALIDATOR_PID"
echo "RPC URL: http://localhost:8999"
echo "Token Mint: $TOKEN_ADDRESS"
echo "Wallet 1: $WALLET1_PUBKEY"
echo "Wallet 2: $WALLET2_PUBKEY"
echo ""
echo "Run 'ts-node scripts/loop-transfer-test.ts 100 1' to test transfers"
echo ""
echo "Stop validator with: kill $VALIDATOR_PID"
```

Let's make the script executable:
<tool_call>terminal
<arg_key>command</arg_key>
<arg_value>chmod +x scripts/simple-setup/setup.sh</arg_value>
<arg_key>cd</arg_key>
<arg_value>/Users/chanthawat/Developments/weekend/gridtokenx-anchor</arg_value>
</tool_call>
