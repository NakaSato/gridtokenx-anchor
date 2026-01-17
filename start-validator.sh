#!/bin/bash
# Start Solana validator in background
solana-test-validator --reset > logs/validator.log 2>&1 &
echo $! > logs/validator.pid
echo "Validator started with PID: $(cat logs/validator.pid)"
sleep 5
solana cluster-version
