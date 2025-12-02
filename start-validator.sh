#!/bin/bash
# Start Solana validator in background
solana-test-validator --reset > validator.log 2>&1 &
echo $! > validator.pid
echo "Validator started with PID: $(cat validator.pid)"
sleep 5
solana cluster-version
