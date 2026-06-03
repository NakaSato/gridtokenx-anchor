import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Trading } from "../target/types/trading";
import { expect } from "chai";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import fs from "fs";

describe("trading zone config", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = (() => {
    const idl = JSON.parse(fs.readFileSync("./target/idl/trading.json", "utf8"));
    return new anchor.Program(idl, provider) as Program<Trading>;
  })();

  it("Initializes zone config", async () => {
    const zoneId = 1;
    const incentiveMultiplierBps = new anchor.BN(15000);

    const [zoneConfigPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("zone_config"),
        (() => {
          const buf = Buffer.alloc(4);
          buf.writeUInt32LE(zoneId);
          return buf;
        })(),
      ],
      program.programId
    );

    await program.methods
      .initializeZoneConfig(zoneId, incentiveMultiplierBps)
      .accounts({
        zoneConfig: zoneConfigPda,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const config = await program.account.zoneConfig.fetch(zoneConfigPda);
    expect(config.zoneId).to.equal(zoneId);
    expect(config.incentiveMultiplierBps.toNumber()).to.equal(15000);
  });
});
