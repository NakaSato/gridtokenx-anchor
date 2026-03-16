import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import type { Blockbench } from "../target/types/blockbench";

describe("Smallbank Benchmark", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Blockbench as Program<Blockbench>;
  const authority = provider.wallet as anchor.Wallet;

  const customerId = new BN(1001);
  const customerId2 = new BN(1002);

  const [customerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sb_customer"), customerId.toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const [savingsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sb_savings"), customerId.toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const [checkingPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sb_checking"), customerId.toArrayLike(Buffer, "le", 8)],
    program.programId,
  );

  const [customer2Pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sb_customer"), customerId2.toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const [checking2Pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sb_checking"), customerId2.toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const [savings2Pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sb_savings"), customerId2.toArrayLike(Buffer, "le", 8)],
    program.programId,
  );

  before(async () => {
    try {
      const signature = await provider.connection.requestAirdrop(
        authority.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(signature);
    } catch (e) {
      console.log("Airdrop failed, assuming already funded or not supported");
    }
  });

  it("Creates a Smallbank account", async () => {
    await program.methods
      .smallbankCreateAccount(
        customerId,
        "Alice" as any,
        new BN(1000),
        new BN(500),
      )
      .accounts({
        customer: customerPda,
        savings: savingsPda,
        checking: checkingPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const customer = await program.account.smallbankCustomer.fetch(customerPda);
    const savings = await program.account.smallbankSavings.fetch(savingsPda);
    const checking = await program.account.smallbankChecking.fetch(checkingPda);

    assert.equal(
      Buffer.from(customer.name as any)
        .toString()
        .replace(/\0/g, ""),
      "Alice",
    );
    assert.ok(savings.balance.eq(new BN(1000)));
    assert.ok(checking.balance.eq(new BN(500)));
  });

  it("Creates a second Smallbank account", async () => {
    await program.methods
      .smallbankCreateAccount(
        customerId2,
        "Bob" as any,
        new BN(2000),
        new BN(1000),
      )
      .accounts({
        customer: customer2Pda,
        savings: savings2Pda,
        checking: checking2Pda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("Performs TransactSavings", async () => {
    await program.methods
      .smallbankTransactSavings(new BN(500))
      .accounts({
        savings: savingsPda,
        authority: authority.publicKey,
      })
      .rpc();

    const savings = await program.account.smallbankSavings.fetch(savingsPda);
    assert.ok(savings.balance.eq(new BN(1500)));
  });

  it("Performs DepositChecking", async () => {
    await program.methods
      .smallbankDepositChecking(new BN(200))
      .accounts({
        checking: checkingPda,
        authority: authority.publicKey,
      })
      .rpc();

    const checking = await program.account.smallbankChecking.fetch(checkingPda);
    assert.ok(checking.balance.eq(new BN(700)));
  });

  it("Performs SendPayment", async () => {
    await program.methods
      .smallbankSendPayment(new BN(300))
      .accounts({
        fromChecking: checkingPda,
        toChecking: checking2Pda,
        authority: authority.publicKey,
      })
      .rpc();

    const checkingAlice =
      await program.account.smallbankChecking.fetch(checkingPda);
    const checkingBob =
      await program.account.smallbankChecking.fetch(checking2Pda);

    assert.ok(checkingAlice.balance.eq(new BN(400)));
    assert.ok(checkingBob.balance.eq(new BN(1300)));
  });

  it("Performs WriteCheck", async () => {
    await program.methods
      .smallbankWriteCheck(new BN(100))
      .accounts({
        checking: checkingPda,
        authority: authority.publicKey,
      })
      .rpc();

    const checking = await program.account.smallbankChecking.fetch(checkingPda);
    assert.ok(checking.balance.eq(new BN(300)));
  });

  it("Performs Amalgamate", async () => {
    await program.methods
      .smallbankAmalgamate()
      .accounts({
        savings: savingsPda,
        checking: checkingPda,
        authority: authority.publicKey,
      })
      .rpc();

    const savings = await program.account.smallbankSavings.fetch(savingsPda);
    const checking = await program.account.smallbankChecking.fetch(checkingPda);

    assert.ok(savings.balance.eq(new BN(0)));
    assert.ok(checking.balance.eq(new BN(1800))); // 300 + 1500
  });
});
