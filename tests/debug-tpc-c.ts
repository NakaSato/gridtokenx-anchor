import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { BN } from "bn.js";
import * as fs from "fs";

async function main() {
    process.env.ANCHOR_PROVIDER_URL = "http://127.0.0.1:8899";
    process.env.ANCHOR_WALLET = "/Users/chanthawat/Developments/gridtokenx-platform-infa/gridtokenx-anchor/scripts/poa-cluster/genesis/faucet-keypair.json";

    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const idl = JSON.parse(fs.readFileSync("target/idl/tpc_benchmark.json", "utf-8"));
    const programId = new PublicKey("BcXcPzZHpBJ82RwDSuVY2eVCXj3enda8R3AxUTjXwFgu");
    const program = new Program(idl, provider);

    console.log("Starting Debug TPC-C Transaction...");

    const w_id = 1;
    const d_id = 1;
    const c_id = 1;

    // Helper functions
    const u64ToBuffer = (num: number) => {
        const buf = Buffer.alloc(8);
        buf.writeBigUInt64LE(BigInt(num));
        return buf;
    };

    const [warehousePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("warehouse"), u64ToBuffer(w_id)],
        programId
    );
    const [districtPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("district"), u64ToBuffer(w_id), u64ToBuffer(d_id)],
        programId
    );
    const [customerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("customer"), u64ToBuffer(w_id), u64ToBuffer(d_id), u64ToBuffer(c_id)],
        programId
    );

    // Generate unique o_id
    const o_id = new BN(Date.now());

    const [orderPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("order"), u64ToBuffer(w_id), u64ToBuffer(d_id), o_id.toArrayLike(Buffer, "le", 8)],
        programId
    );
    const [newOrderPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("new_order"), u64ToBuffer(w_id), u64ToBuffer(d_id), o_id.toArrayLike(Buffer, "le", 8)],
        programId
    );

    const orderLines = [];
    const remainingAccounts = [];

    for (let i = 1; i <= 5; i++) {
        const i_id = i;
        orderLines.push({
            iId: new BN(i_id),
            supplyWId: new BN(w_id),
            quantity: 5
        });

        const [itemPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("item"), u64ToBuffer(i_id)],
            programId
        );
        const [stockPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("stock"), u64ToBuffer(w_id), u64ToBuffer(i_id)],
            programId
        );

        remainingAccounts.push({ pubkey: itemPda, isWritable: false, isSigner: false });
        remainingAccounts.push({ pubkey: stockPda, isWritable: true, isSigner: false });
    }

    try {
        console.log("Sending NewOrder transaction...");
        const tx = await program.methods
            .newOrder(new BN(w_id), new BN(d_id), new BN(c_id), o_id, orderLines)
            .accounts({
                warehouse: warehousePda,
                district: districtPda,
                customer: customerPda,
                order: orderPda,
                newOrder: newOrderPda,
                payer: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .remainingAccounts(remainingAccounts)
            .rpc();
        console.log("Success! TX:", tx);
    } catch (err: any) {
        console.error("Failed!");
        console.error("Error Message:", err.message);
        if (err.logs) {
            console.error("Logs:");
            err.logs.forEach((log: string) => console.error(log));
        }
    }
}

main();
