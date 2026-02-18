import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Governance } from "../../target/types/governance";

export const getGovernancePda = (programId: PublicKey) => {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("poa_config")],
        programId
    )[0];
};

export const initializeGovernance = async (
    provider: anchor.AnchorProvider,
    program: anchor.Program<Governance>
) => {
    const governancePda = getGovernancePda(program.programId);

    try {
        await program.methods
            .initializePoa()
            .accounts({
                poaConfig: governancePda,
                authority: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
        return governancePda;
    } catch (e: any) {
        if (e.message.includes("already in use")) {
            return governancePda;
        }
        throw e;
    }
};
