import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Registry } from "../target/types/registry";
import { EnergyToken } from "../target/types/energy_token";
import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// Canonical SPL Token-2022 (Token Extensions) program. bootstrap.ts must wire
// every `tokenProgram` account to THIS id so the GRX mint, staking vault, and
// every downstream ATA agree on one token program. The legacy SPL Token id and
// the bogus `...Thp9Dz9...` id that used to live in the fallback path are both
// regressions and are asserted against below.
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);
const LEGACY_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const BOGUS_TOKEN_ID = "TokenzQdBNbLqP5VEhdkThp9Dz9L33itf29V7D3fR65";

describe("bootstrap token-2022 wiring", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  const registry = anchor.workspace.Registry as Program<Registry>;
  const energyToken = anchor.workspace.EnergyToken as Program<EnergyToken>;

  const [mintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_2022")],
    energyToken.programId
  );
  const [grxVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("grx_vault")],
    registry.programId
  );

  // --- Static source guard: lock the ids bootstrap.ts hands to the chain. ---
  it("bootstrap.ts wires only the canonical Token-2022 program id", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "scripts", "bootstrap.ts"),
      "utf-8"
    );
    // Every tokenProgram account literal must be Token-2022.
    const tokenProgramIds = [
      ...src.matchAll(/tokenProgram:\s*new PublicKey\(['"]([^'"]+)['"]\)/g),
    ].map((m) => m[1]);
    expect(tokenProgramIds.length, "expected >=3 tokenProgram accounts").to.be.at.least(3);
    for (const id of tokenProgramIds) {
      expect(id).to.equal(TOKEN_2022_PROGRAM_ID.toBase58());
    }
    // The legacy + bogus ids must never reappear in the script.
    expect(src).to.not.include(LEGACY_TOKEN_PROGRAM_ID);
    expect(src).to.not.include(BOGUS_TOKEN_ID);
  });

  // --- On-chain reality: bootstrapped accounts are owned by Token-2022. ---
  // Requires a bootstrapped validator (scripts/bootstrap.ts already run).
  it("GRX mint_2022 is a Token-2022 mint", async () => {
    const info = await provider.connection.getAccountInfo(mintPda);
    expect(info, `mint_2022 ${mintPda.toBase58()} not found — run bootstrap.ts first`).to.not.be.null;
    expect(info!.owner.toBase58()).to.equal(TOKEN_2022_PROGRAM_ID.toBase58());
  });

  it("grx_vault is a Token-2022 token account holding mint_2022", async () => {
    const info = await provider.connection.getAccountInfo(grxVaultPda);
    expect(info, `grx_vault ${grxVaultPda.toBase58()} not found — run bootstrap.ts first`).to.not.be.null;
    expect(info!.owner.toBase58()).to.equal(TOKEN_2022_PROGRAM_ID.toBase58());
    // SPL token account layout: bytes [0..32) = mint pubkey.
    const vaultMint = new PublicKey(info!.data.subarray(0, 32));
    expect(vaultMint.toBase58()).to.equal(mintPda.toBase58());
  });
});
