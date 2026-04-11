#!/usr/bin/env bash
# Step 1: Environment verification script
# Run this to confirm all required tools are present.

set -e

export PATH="$HOME/.avm/bin:$HOME/.cargo/bin:/opt/solana/bin:$PATH"

echo "=== RankBasedBettingMarket — Environment Check ==="
echo ""

echo "Rust:   $(rustc --version)"
echo "Cargo:  $(cargo --version)"
echo "Solana: $(solana --version)"
echo "Anchor: $(anchor --version)"
echo "Node:   $(node --version)"
echo "Yarn:   $(yarn --version)"

echo ""
echo "Solana config:"
solana config get

echo ""
echo "All tools present. Step 1 PASSED."
