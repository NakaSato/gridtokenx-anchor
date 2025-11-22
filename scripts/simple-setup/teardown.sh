#!/usr/bin/env bash

# Teardown Script for GridTokenX Project

echo "🔧 GridTokenX Teardown"
echo "================================"

# 1. Kill validator
echo "Stopping validator..."
VALIDATOR_PID=$(cat validator.pid 2>/dev/null || echo "")
if [ -n "$VALIDATOR_PID" ]; then
    kill $VALIDATOR_PID
    echo "Validator (PID $VALIDATOR_PID) stopped"
else
    echo "No validator PID found, killing by process name"
    pkill -f solana-test-validator
fi

# 2. Clean up temporary files
echo "Cleaning up temporary files..."
rm -f grx-mint-keypair.json
rm -f wallet-1-keypair.json
rm -f wallet-2-keypair.json
rm -f grx-token-info.json
rm -f validator.pid

# 3. Reset Solana config to default
echo "Resetting Solana config..."
solana config set --url localhost

echo ""
echo "✅ Teardown Complete!"
echo "================================"
```

Now that we have our setup and teardown scripts, let's run the setup:
<tool_call>terminal
<arg_key>command</arg_key>
<arg_value>cd scripts/simple-setup && ./setup.sh</arg_value>
<arg_key>cd</arg_key>
<arg_value>/Users/chanthawat/Developments/weekend/gridtokenx-anchor</arg_value>
</tool_call>
