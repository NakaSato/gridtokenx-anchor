import * as anchor from '@anchor-lang/core';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import BN from 'bn.js';
import { createHash } from 'crypto';

// DEV-ONLY: fund the treasury's THBC inventory vault so `exchange_grx_for_thbc`
// can pay out. The real flow is a bank deposit -> partner webhook -> issuer
// calls `issue_thbc`; the payment leg of that webhook is deliberately 501 (spec
// §12, "not built is not refused"), so on a dev chain this script plays the
// issuer: on-chain attestation -> issue_thbc to the authority's ATA -> plain
// SPL transfer into the `[b"thbc_inventory"]` vault (nothing in the program
// mints into the vault, by design — F6).
//
//   ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=../dev-wallet.json \
//     npx tsx scripts/fund-thbc-inventory.ts
//
// Env: FUND_THBC_MINOR (default 500_000000 = 500 THBC), FUND_BANK_REF,
// FUND_BENEFICIARY_WALLET — when set, issue to THAT wallet's ATA and skip the
// inventory transfer entirely (a simulated user bank deposit instead of
// platform inventory buying).
async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const treasuryProgram = anchor.workspace.Treasury;
  const authority = provider.wallet;

  const pid = treasuryProgram.programId;
  const [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from('treasury')], pid);
  const [thbcMint] = PublicKey.findProgramAddressSync([Buffer.from('thbc_mint')], pid);
  const [thbcInventory] = PublicKey.findProgramAddressSync([Buffer.from('thbc_inventory')], pid);

  const amountMinor = new BN(process.env.FUND_THBC_MINOR ?? '500000000'); // 500 THBC (6dp)
  const bankRef = process.env.FUND_BANK_REF ?? `dev-fund-inventory-${Date.now()}`;
  const refHash = createHash('sha256').update(bankRef).digest();
  const [nullifier] = PublicKey.findProgramAddressSync([Buffer.from('deposit'), refHash], pid);

  // 1. On-chain reserve attestation — the F1/F5 gate `issue_thbc` checks first.
  //    Dev figure well above anything this script will ever issue.
  await treasuryProgram.methods
    .updateAttestation(new BN('1000000000000'), new BN(0))
    .accounts({ treasury: treasuryPda, attestor: authority.publicKey })
    .rpc();
  console.log('✅ on-chain reserve attested (1,000,000 THB, encumbered 0)');

  // 2. Issue THBC (nullifier `init` = the F3 replay guard). Beneficiary is the
  //    authority (inventory-buy mode) or FUND_BENEFICIARY_WALLET (user-deposit
  //    mode — the simulated "bank received their THB" outcome).
  const beneficiaryOwner = process.env.FUND_BENEFICIARY_WALLET
    ? new PublicKey(process.env.FUND_BENEFICIARY_WALLET)
    : authority.publicKey;
  const userMode = !beneficiaryOwner.equals(authority.publicKey);
  const ata = getAssociatedTokenAddressSync(thbcMint, beneficiaryOwner, false, TOKEN_2022_PROGRAM_ID);
  const issueSig = await treasuryProgram.methods
    .issueThbc(amountMinor, Array.from(refHash))
    .accounts({
      treasury: treasuryPda,
      thbcMint,
      beneficiaryThbcAta: ata,
      depositNullifier: nullifier,
      issuer: authority.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([
      createAssociatedTokenAccountIdempotentInstruction(
        authority.publicKey, ata, beneficiaryOwner, thbcMint, TOKEN_2022_PROGRAM_ID
      ),
    ])
    .rpc();
  console.log(`✅ issued ${amountMinor.toString()} minor THBC to ${beneficiaryOwner.toBase58()} (bank_ref='${bankRef}') tx=${issueSig}`);

  if (userMode) {
    const bal = await provider.connection.getTokenAccountBalance(ata);
    console.log(`📊 beneficiary THBC balance: ${bal.value.uiAmountString}`);
    return;
  }

  // 3. Inventory-buy mode only: plain SPL transfer into the inventory vault
  //    (exactly how the platform "buys its inventory like anyone else").
  const tx = new Transaction().add(
    createTransferCheckedInstruction(
      ata, thbcMint, thbcInventory, authority.publicKey,
      BigInt(amountMinor.toString()), 6, [], TOKEN_2022_PROGRAM_ID
    )
  );
  const xferSig = await provider.sendAndConfirm(tx, []);
  console.log(`✅ transferred into inventory vault ${thbcInventory.toBase58()} tx=${xferSig}`);

  const bal = await provider.connection.getTokenAccountBalance(thbcInventory);
  console.log(`📊 inventory balance: ${bal.value.uiAmountString} THBC`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
