import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Trading } from "../../../target/types/trading";
import BN from "bn.js";

export class GridTokenXClient {
    public program: Program<Trading>;

    constructor(program: Program<Trading>) {
        this.program = program;
    }

    /**
     * Initialize a private balance for confidential trading
     */
    public async initializePrivateBalance(
        owner: PublicKey,
        mint: PublicKey,
        initialValue: number = 0
    ) {
        // In a real ZK SDK, we would generate a commitment and blinding factor here
        const blindingFactor = Array(32).fill(0); // For demo
        const initialCommitment = {
            point: Array(32).fill(1) // Placeholder for real Ristretto point
        };

        const [privateBalance] = PublicKey.findProgramAddressSync(
            [Buffer.from("private_balance"), owner.toBuffer(), mint.toBuffer()],
            this.program.programId
        );

        return await this.program.methods.initializePrivateBalance(
            initialCommitment,
            Array(32).fill(0), // encrypted_balance
            Array(24).fill(0)  // encryption_nonce
        ).accounts({
            //@ts-ignore
            privateBalance,
            mint,
            owner,
            systemProgram: anchor.web3.SystemProgram.programId,
        }).rpc();
    }

    /**
     * Get the current dynamic pricing for a market
     */
    public async getPricing(market: PublicKey) {
        const [pricingConfig] = PublicKey.findProgramAddressSync(
            [Buffer.from("pricing_config"), market.toBuffer()],
            this.program.programId
        );

        return await this.program.account.pricingConfig.fetch(pricingConfig);
    }

    /**
     * Initialize a carbon marketplace configuration
     */
    public async initCarbonMarketplace(
        authority: PublicKey,
        recMint: PublicKey,
        carbonMint: PublicKey,
        treasury: PublicKey
    ) {
        const [marketplace] = PublicKey.findProgramAddressSync(
            [Buffer.from("carbon_marketplace"), authority.toBuffer()],
            this.program.programId
        );

        return await this.program.methods.initializeCarbonMarketplace(
            100, // 1% fee
            50,  // 0.5% retirement fee
            1000, // 1 REC = 1000 Carbon
            500   // Intensity
        ).accounts({
            marketplace,
            recMint,
            carbonMint,
            treasury,
            authority,
            systemProgram: anchor.web3.SystemProgram.programId,
        }).rpc();
    }
}
