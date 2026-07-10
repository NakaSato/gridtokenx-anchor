import * as anchor from '@anchor-lang/core';
import { PublicKey } from '@solana/web3.js';

// Register a DISTINCT REC-validator co-signer on the energy-token TokenInfo.
//
// The energy-token `mint_generation` enforces two-party control: the REC
// co-signer must be a registered validator AND differ from the platform
// authority (`rec_key != authority`, Custom 6012). The chain-bridge surplus-mint
// path co-signs with a dedicated key derived from `CHAIN_BRIDGE_REC_VALIDATOR_KEY_NAME`
// (default "gridtokenx-rec-validator") — this script registers THAT key's pubkey
// so the mint's membership check passes.
//
// Pubkey is deterministic from the key name (insecure provider derives
// keypair_from_seed(sha256(name)); real Vault uses the named transit key). Pass a
// pubkey as argv[2], else defaults to the derived dev pubkey for the default name.
//
// Usage: REC_PUBKEY=<base58> anchor run ... OR: npx tsx scripts/add-rec-validator.ts <pubkey>
async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const energyTokenProgram = anchor.workspace.EnergyToken;
  const governanceProgram = anchor.workspace.Governance;
  const authority = provider.wallet.publicKey;

  const recPubkeyStr =
    process.argv[2] ||
    process.env.REC_PUBKEY ||
    'DzmdjTAB4qUVrpxjDAHUTY6cQSyMVNkWCEMkH7aHdpVA'; // sha256("gridtokenx-rec-validator") seed
  const recValidator = new PublicKey(recPubkeyStr);

  if (recValidator.equals(authority)) {
    throw new Error('REC validator must differ from the platform authority (Custom 6012)');
  }

  const [tokenInfoPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_info_2022')],
    energyTokenProgram.programId
  );
  const [governanceConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('governance_config')],
    governanceProgram.programId
  );

  console.log('Authority     :', authority.toBase58());
  console.log('REC validator :', recValidator.toBase58());

  try {
    await energyTokenProgram.methods
      .addRecValidator(recValidator, 'rec-cosigner')
      .accounts({
        tokenInfo: tokenInfoPda,
        governanceConfig: governanceConfigPda,
        authority: authority,
      } as any)
      .rpc();
    console.log('  ✅ Distinct REC validator registered:', recValidator.toBase58());
  } catch (e: any) {
    // ValidatorAlreadyExists on a re-run is fine.
    console.log('  ℹ️  add_rec_validator:', e.message);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
