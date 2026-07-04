// role-map.md fix #1: governance authority = single Pubkey → k-of-n council.
//
// governance_config.authority is checked as a plain `Signer<'info>` everywhere
// (has_one = authority; see contexts.rs). Anchor/Solana's Signer check is purely
// "is this AccountInfo marked is_signer" — it does not distinguish an ed25519
// keypair signing directly from a program's PDA signing via invoke_signed CPI.
// This repo already relies on that exact property elsewhere (e.g. trading's
// market_authority PDA signs settlement transfers via invoke_signed,
// settle_offchain.rs). So no governance program code changes are needed to move
// to a k-of-n multisig — any external multisig program (Squads, native
// SPL-governance, etc.) whose vault is a PDA can hold governance authority: once
// a proposal reaches its k-of-n threshold, the multisig program CPIs into
// governance signing with its vault's seeds, satisfying `Signer<'info>` exactly
// like a single keypair would.
//
// This script runs the FIRST half of the existing 2-step transfer
// (propose_authority_change, signed by the CURRENT single-key authority). It
// cannot run the second half (approve_authority_change) itself when the target
// is a real external multisig — that must be signed by the multisig's own vault
// PDA, which only happens through THAT program's execute-proposal flow (e.g. the
// Squads UI/CLI). Print the follow-up instructions instead of pretending to
// finish an operation this script structurally cannot complete standalone.
//
// Usage:
//   npx tsx scripts/migrate-governance-authority.ts <multisig-vault-pubkey>
import * as anchor from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: npx tsx scripts/migrate-governance-authority.ts <multisig-vault-pubkey>");
    process.exit(1);
  }
  const newAuthority = new PublicKey(target);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const governanceProgram = anchor.workspace.Governance;

  const [governanceConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance_config")],
    governanceProgram.programId
  );

  console.log("Governance config:", governanceConfigPda.toBase58());
  console.log("Current authority (this wallet):", provider.wallet.publicKey.toBase58());
  console.log("Proposing new authority (multisig vault):", newAuthority.toBase58());

  const tx = await governanceProgram.methods
    .proposeAuthorityChange(newAuthority)
    .accounts({
      governanceConfig: governanceConfigPda,
      authority: provider.wallet.publicKey,
    })
    .rpc();

  console.log("✅ propose_authority_change submitted. TX:", tx);
  console.log("");
  console.log("NEXT STEP (cannot be automated here): the multisig at", newAuthority.toBase58());
  console.log("must execute a proposal that CPIs into governance's approve_authority_change");
  console.log("instruction, accounts = { governanceConfig:", governanceConfigPda.toBase58(), ", newAuthority: <the vault PDA> },");
  console.log("signed via that program's own invoke_signed — e.g. via the Squads UI/CLI's");
  console.log("\"add instruction to proposal\" flow. The pending change expires in 48h if not approved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
