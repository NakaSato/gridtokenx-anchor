import { createHash } from "crypto";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
    Keypair,
    PublicKey,
    SystemProgram,
    LAMPORTS_PER_SOL
} from "@solana/web3.js";
import {
    createMint,
    mintTo,
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import type { Trading } from "../target/types/trading";

const ZK_TOKEN_PROOF_PROGRAM_ID = new PublicKey("ZkTokenProof1111111111111111111111111111111");

describe("Confidential Settlement Integration", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Trading as Program<Trading>;
    const authority = provider.wallet as anchor.Wallet;

    const seller = Keypair.generate();
    const buyer = Keypair.generate();
    const escrowAuthority = Keypair.generate();

    let energyMint: PublicKey;
    let currencyMint: PublicKey;

    let sellerEnergyEscrow: PublicKey;
    let buyerEnergyAccount: PublicKey;
    let buyerCurrencyConfidential: PublicKey;
    let sellerCurrencyConfidential: PublicKey;

    let marketAddress: PublicKey;
    let buyOrderPda: PublicKey;
    let sellOrderPda: PublicKey;

    // Real proofs generated via gen-proof-tool
    const realRangeProof = {
        commitment: { data: [...Buffer.from("4009e991fa95311ed64b7df57d2b70eefb8ccdc666b39f64c02a446de9b5a651", "hex")] },
        proof: Buffer.from("de1cd7b81f54176fb0a3c69c7309d41ce3c4e316dcbbf4819632b54003147923dca914ef84069ade9124b9fa2c156fbddd0f2b8f8df5b9a6382c1345a7314803c0568146f57c134f7ddd18fc9da0881dc2c30d0cbb08e79d7977e5fca6a3cf1578e70a3b6af5f775baaf4583f8cd2d5d3cf0496df86fe4ba1e3e679b466d0b70e35562f1f331bf706de8d687a83fe5bfe757e8d485c365c7e290ee90f9fd920fef0edf90d7c15a5e04ab9f01c483d61a37fef104d783bb5783c504c8cd310b085e799da467f6d9c06b69c114dca63f7926e82a34c7e390fb64b422c90a91cb059618b93cad5563d42fc32486fae12d48e5ceb9da2e4a8aa93985899d7c19130112df51ff0ceca40a1741f566d6064e0932953b9a6b6577dd91b452388ff1575af2e2ad6809421cf47f678552dabbd73bf7ee08974076527e0fb64120a932361ec4dd3486580b9ea4a26a278f387b078ccfd0a8585a43b3c30fa49c9ba4815c7ce0729d9f1470f11639562969574242a8a8feac90d17c4279de56059092bdb1209a8476e55debd27cd1bcc5b12bedc57df858623cf8a3b5eba6a9408650ff586c7a6230553439b1bbc7d741f3b3e3a583c16550bd8385e05f1413b16a54da3733366fe72c305f8397512be9c8e24d78942ac901ce3ab3e2981e0c479518929b62c24819a234fd48c92072252c57895557f56b00789ab3d2891efaf9307edb992d2c6b5b7806404a646079b65cb5e952b20c6ead2687a161cc92671ae4beb27e66785c2559ae105f2f6885d670de17cb00fdc46905bc915bd9bb0122f0ebb6b226001396a21f698f2c106524904348dd29acf658d83a050e1260dc2a9c1f0e220f68c3f52d11f62ce58aec272b6cede356d2fd33bfa9a5c9c8b6c1d180eaf6c30d616a013e308adf147045bb9a1799daf011fd9f806534b0bff2cd5852237d8b02", "hex")
    };
    const realTransferProof = {
        amountCommitment: { data: [...Buffer.from("4009e991fa95311ed64b7df57d2b70eefb8ccdc666b39f64c02a446de9b5a651", "hex")] },
        proof: Buffer.from("4009e991fa95311ed64b7df57d2b70eefb8ccdc666b39f64c02a446de9b5a651ac92f6e9f6b7d0e2a37125366e1b581235a999be84911024faa3787fb703ee50e4238c2503a3d3ee2f5822f1a09a91ba592ada498ddbefbba635bbd09f655b68e4238c2503a3d3ee2f5822f1a09a91ba592ada498ddbefbba635bbd09f655b68ca9921c737f63dd967c6211d059786ecebbcb938c5c7cbd1b79876b7f98d037892933ab430ff4cf1a80a80fb9e4a2f7283fc4e3cb6b52ac83bbd0b5b0fde3033165b8ea56fefe570dad8bd8966582c3182d892286ff58bb1079415bc051c0c67165b8ea56fefe570dad8bd8966582c3182d892286ff58bb1079415bc051c0c67c4627946f42ec779d3951e926010041332fe2a18a1868b9fc262629f6a62f702c0fb720df2c27748f5259fba49e3e5c4a6c7838f33d92d3a26bfdfe622351936c0fb720df2c27748f5259fba49e3e5c4a6c7838f33d92d3a26bfdfe6223519364cd126f0cd7127ff99d9cf597c54dafa2dd9ca095af4906141bdbd622e63733b3cbee5ded3f832f425ac32a206de828d6b904352235b3f02872f4adffb9bee348ef747bce884e38d9670058ab32456d16459342cb71235c61844aed2b21a6a50344025c278eea9b70fab1d6d43d29738f9e104f381a4b5e254861a725351be20e2f29ea87323479e8e3cc193b3a1070bbd4731ff5d29c1309e9755b7a326951e16047cfd608cd58a4bac2488a2cae6e923c0af77fe3e3461bbbb5e182bb46e147a94a7875acff9f63b9eb9479a5a397f4558d5be62fbaf685e7a2b6e9d5eb908089b64a0fe4d54e01c000ab75d7a410c5ab186b9a3e39751e6175235b497470d5aeaa2efe6bbd58e2b53c428d07b5ff9143b7f41d54f730ad5896251e06a930574ae52421e1000b1675f6c27e783d2f31aebd9873dee3621de1ac4ac387be84cfcfa54cadfc7b9fe453f9a530cbbbb004e1377e3dae9d67cf9838bca8b604a38fcfa54cadfc7b9fe453f9a530cbbbb004e1377e3dae9d67cf9838bca8b604a388e8186c7e028f35c32448651323ba433208f63aa3167c9a0c014d872fb78640f6321d69d8718761b14534b251083a7d9fb0ed7d47077388256020b83f24afb0196d2441c7ccb0f189e0e98b26ca8176fcde12030a9f3184cdb1c9fed5092972d485908c36d0cfa965e2e415c746d0856521203e9b3acab0327eddf72cb49dc47b212609ddedee5f2a71928ab18f67fbffd77e5af3f46dbfa6cd92642dd0e4f733e4dd90dcdb9b33b11334b595f496833ebd7c4e68bcfd20332ea4a771cefcb1a3510fff01e1202f4e6513f16bee0ae9b3d366bd95e1f45314d702f1da549aa00799114837b0f2a97088e712e03f046368e2da3c44967fc6d55b655c3815463039e61565dd8e0f2db7c02d8644f4a956c1ebbddbf3bf91520f82e13128c5a0e0018cdc148e3368871698257d1143d66a29a346b1f7e0b000a00f8466dd890e62d1200b019791c278faa7d5c31768baeb88e237b26d1927f6306f4c4eb05641d6c504def99b8833ac73838b15f8ea899d3f9fa3ba7af47e5f0903807c7c46e5c31b48679de4dd400f3b3c0e6c0c662bf37169b33de31d58216da5356631ce3614d0876e82fac8d6951d4f603c929235964d11265e1eba7c5ad90400d3737bd915112b99f3282e4b9989b035975a4fb3b5730a9f7ce7ad7b3f61acd10ed554978568aabac8ec090ac4709ac89ea94616072ecebc59e9aea11831c1924e21f29811916008e44843f5371453a3920d8e26dc377675b9ac05c1c7d00b4752b70fd140bda09020db6441f79084870396b44fc0a217e45707f354a2ada23664071198648460967c1e51846192bbce4b72e9142f4d761ea17446f5cc2435c64f391efea5f9eb669d066152ade1cb288241cf303ad6e33d19a5f8679857d5c8e7f80b9bb5942ae9566f2a77a8e6ee69e27057e1e7b2ef207c0f92fe943c66a6a6246410e3af2146b32e97d2e4bed40fa8b961c99926baec0f3850c53dc6469418659390701580bb187291d77e83b6291196a150ddc2d60cbdc2d1314e5e14136e8c661633b62c291a9776cb97709009652ac9315fed0f69c9a68bc877df0f88a049fb2d00320d10ee005f77c0945d420e25bfcaf018c8f65c884ae0c475906b8736151a40e", "hex")
    };
    const mockCiphertext = { data: Buffer.alloc(64, 0) };

    async function createATA(owner: PublicKey, mint: PublicKey, programId: PublicKey, payer: Keypair = authority.payer as any) {
        const ata = getAssociatedTokenAddressSync(mint, owner, false, programId);
        const ix = createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint, programId);
        const tx = new anchor.web3.Transaction().add(ix);
        await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [payer]);
        return ata;
    }

    before(async () => {
        // Airdrops
        for (const kp of [seller, buyer, escrowAuthority]) {
            const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
            const latest = await provider.connection.getLatestBlockhash();
            await provider.connection.confirmTransaction({ signature: sig, ...latest });
        }

        // 1. Create Mints
        energyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 9, undefined, undefined, TOKEN_2022_PROGRAM_ID);
        currencyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 6, undefined, undefined, TOKEN_PROGRAM_ID);

        // 2. Setup ATAs
        sellerEnergyEscrow = await createATA(escrowAuthority.publicKey, energyMint, TOKEN_2022_PROGRAM_ID, escrowAuthority);
        buyerEnergyAccount = await createATA(buyer.publicKey, energyMint, TOKEN_2022_PROGRAM_ID);

        // 3. Setup Confidential PDAs (for Currency)
        [buyerCurrencyConfidential] = PublicKey.findProgramAddressSync(
            [Buffer.from("confidential_balance"), buyer.publicKey.toBuffer(), currencyMint.toBuffer()],
            program.programId
        );
        [sellerCurrencyConfidential] = PublicKey.findProgramAddressSync(
            [Buffer.from("confidential_balance"), seller.publicKey.toBuffer(), currencyMint.toBuffer()],
            program.programId
        );

        // 4. Setup Market
        [marketAddress] = PublicKey.findProgramAddressSync([Buffer.from("market")], program.programId);
        try {
            await program.methods.initializeMarket().accounts({
                market: marketAddress,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId
            }).rpc();
        } catch (e) { }

        // 5. Fund Seller Energy Escrow
        await mintTo(provider.connection, authority.payer, energyMint, sellerEnergyEscrow, authority.payer, 1000, [], undefined, TOKEN_2022_PROGRAM_ID);
    });

    it("Performs full flow: Confidential Match & Settlement", async () => {
        // A. Initialize Confidential Balances for Currency
        await program.methods.initializeConfidentialBalance().accounts({
            confidentialBalance: buyerCurrencyConfidential,
            mint: currencyMint,
            owner: buyer.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([buyer]).rpc();

        await program.methods.initializeConfidentialBalance().accounts({
            confidentialBalance: sellerCurrencyConfidential,
            mint: currencyMint,
            owner: seller.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([seller]).rpc();

        // B. Create Public Orders
        const sellOrderId = new BN(101);
        [sellOrderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), seller.publicKey.toBuffer(), sellOrderId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        await program.methods.createSellOrder(sellOrderId, new BN(100), new BN(50)).accounts({
            market: marketAddress,
            order: sellOrderPda,
            ercCertificate: null,
            authority: seller.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([seller]).rpc();

        const buyOrderId = new BN(202);
        [buyOrderPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("order"), buyer.publicKey.toBuffer(), buyOrderId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        await program.methods.createBuyOrder(buyOrderId, new BN(100), new BN(50)).accounts({
            market: marketAddress,
            order: buyOrderPda,
            authority: buyer.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([buyer]).rpc();

        // C. Execute Confidential Settlement
        // This will verify the payment (ZK) and transfer energy (Public)
        const amount = new BN(100);
        const price = new BN(50);

        await program.methods.executeConfidentialSettlement(
            amount,
            price,
            { data: [...mockCiphertext.data] },
            {
                amountCommitment: { data: [...realTransferProof.amountCommitment.data] },
                proof: realTransferProof.proof
            }
        ).accounts({
            market: marketAddress,
            buyOrder: buyOrderPda,
            sellOrder: sellOrderPda,
            buyerConfidentialBalance: buyerCurrencyConfidential,
            sellerConfidentialBalance: sellerCurrencyConfidential,
            sellerEnergyEscrow: sellerEnergyEscrow,
            buyerEnergyAccount: buyerEnergyAccount,
            energyMint: energyMint,
            mint: currencyMint,
            escrowAuthority: escrowAuthority.publicKey,
            zkTokenProofProgram: ZK_TOKEN_PROOF_PROGRAM_ID,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId
        } as any).signers([escrowAuthority]).rpc();

        // D. Verification
        const buyerEnergyBal = await provider.connection.getTokenAccountBalance(buyerEnergyAccount);
        assert.equal(buyerEnergyBal.value.amount, "100");

        const sellerBal = await program.account.confidentialBalance.fetch(sellerCurrencyConfidential);
        // lastUpdateSlot should be > 0 indicating it received a "transfer" update
        assert.ok(sellerBal.lastUpdateSlot.gtn(0));

        const buyOrder = await program.account.order.fetch(buyOrderPda);
        assert.equal(buyOrder.status, 2); // Completed
    });
});
