# Authority Wallet Funding Options

## Current Status

- **Authority Wallet:** `AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3`
- **Current Balance:** 0 SOL
- **Required:** ~10 SOL for testing (covers gas fees for minting + transfers)

## Option 1: Automated Retry Script ⭐ Recommended

```bash
cd gridtokenx-anchor
./fund-authority.sh
```

This script will retry the airdrop every 30 seconds for up to 20 attempts.

## Option 2: Manual Airdrop Retry

```bash
# Try smaller amounts (sometimes works better)
solana airdrop 1 AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3
solana airdrop 2 AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3
solana airdrop 5 AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3
```

## Option 3: Restart Validator

```bash
cd gridtokenx-anchor
pkill solana-test-validator
./start-validator.sh
sleep 5
solana airdrop 10 AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3
```

## Option 4: Use Devnet

```bash
# Update .env in gridtokenx-apigateway
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_WS_URL=wss://api.devnet.solana.com

# Request devnet airdrop
solana config set --url devnet
solana airdrop 2 AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3

# Note: May be rate-limited, try again in 1-2 hours
```

## Option 5: Manual Transfer from Another Wallet

If you have another funded wallet:

```bash
solana transfer AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3 10 \\
  --from /path/to/funded-wallet.json
```

## Option 6: Use Faucet (Devnet only)

Visit: https://faucet.solana.com/

- Paste: `AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3`
- Request airdrop

## Verification

After funding, check balance:

```bash
solana balance AmeT4PvH96gx8AiuLkpjsX9ExA21oH2HtthgbvzDgnD3
```

## What Happens After Funding

Once the authority wallet has SOL:

1. MeterPollingService will successfully mint tokens (runs every 60s)
2. P2P transfer logic will execute
3. Tokens will transfer to corporate user ATA
4. Check logs for: "Found Corporate User", "Transfer to Corporate User successful"

## Monitoring Logs

```bash
cd ../gridtokenx-apigateway
tail -f api_final.log | grep -E "(Found Corporate|Transfer to Corporate|Successfully minted)"
```
