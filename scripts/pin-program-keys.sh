#!/usr/bin/env bash
# Restore the pinned localnet program keypairs into target/deploy so
# `anchor build` / `anchor deploy` keep the program IDs declared in
# Anchor.toml [programs.localnet].
#
# Why: target/ is gitignored, so a fresh clone or `anchor clean` loses the
# deploy keypairs and the next build mints RANDOM program IDs — silently
# breaking every consumer that pins them (root .env SOLANA_*_PROGRAM_ID,
# explorer, e2e tests). The canonical keypairs are vendored in
# keys/localnet/ (dev-only, localnet-only keys — an explicit exception to
# the no-committed-keypairs rule; they hold no value and only pin addresses).
#
# Run after clone / anchor clean, before anchor build:
#   ./scripts/pin-program-keys.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

mkdir -p target/deploy

# Guard first: if a target/deploy keypair already exists and disagrees with
# keys/localnet (e.g. a rotated ID from `anchor keys sync` not yet vendored
# back into keys/localnet), abort instead of silently overwriting it below.
for kp in keys/localnet/*-keypair.json; do
  name="$(basename "$kp")"
  dst="target/deploy/$name"
  prog="$(basename "$kp" -keypair.json)"
  vendored_pub="$(solana-keygen pubkey "$kp")"
  if [ -f "$dst" ] && ! cmp -s "$kp" "$dst"; then
    dst_pub="$(solana-keygen pubkey "$dst")"
    if ! rg -q "$dst_pub" Anchor.toml; then
      echo "ERROR: target/deploy/$name ($dst_pub) doesn't match keys/localnet ($vendored_pub) and $dst_pub isn't in Anchor.toml either." >&2
      echo "       Refusing to overwrite — looks like an untracked rotation. Re-vendor keys/localnet or run 'anchor keys sync' first." >&2
      exit 1
    fi
    echo "WARNING: target/deploy/$name ($dst_pub) differs from keys/localnet ($vendored_pub) but matches Anchor.toml — leaving it as-is." >&2
  fi
done

changed=0
for kp in keys/localnet/*-keypair.json; do
  name="$(basename "$kp")"
  dst="target/deploy/$name"
  if [ -f "$dst" ] && cmp -s "$kp" "$dst"; then
    continue
  fi
  if [ -f "$dst" ]; then
    dst_pub="$(solana-keygen pubkey "$dst")"
    if rg -q "$dst_pub" Anchor.toml; then
      continue
    fi
  fi
  cp "$kp" "$dst"
  changed=1
  echo "pinned $name -> $(solana-keygen pubkey "$dst")"
done
[ "$changed" = 0 ] && echo "all program keypairs already pinned"

# Guard: warn loudly if a pinned pubkey disagrees with Anchor.toml.
for kp in keys/localnet/*-keypair.json; do
  prog="$(basename "$kp" -keypair.json)"
  pub="$(solana-keygen pubkey "$kp")"
  if ! rg -q "$pub" Anchor.toml; then
    echo "WARNING: $prog pubkey $pub not found in Anchor.toml [programs.localnet] — sync one of them" >&2
  fi
done
