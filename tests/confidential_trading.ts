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
    setAuthority,
    AuthorityType
} from "@solana/spl-token";
import { assert } from "chai";
import type { Trading } from "../target/types/trading";

const ZK_TOKEN_PROOF_PROGRAM_ID = new PublicKey("ZkTokenProof1111111111111111111111111111111");

describe("Confidential Trading", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Trading as Program<Trading>;
    const authority = provider.wallet as anchor.Wallet;

    const userA = Keypair.generate();
    const userB = Keypair.generate();
    let energyMint: PublicKey;
    let userA_Token: PublicKey;
    let userB_Token: PublicKey;

    let userA_Confidential: PublicKey;
    let userB_Confidential: PublicKey;

    // Helpers for mocks
    function sha256(data: Buffer[]): Buffer {
        const hash = createHash("sha256");
        data.forEach(d => hash.update(d));
        return hash.digest();
    }

    // Mock ciphertexts: WrappedElGamalCiphertext { inner: [u8; 64] }
    const mockCiphertext = {
        data: Buffer.alloc(64, 0)
    };

    // Real proofs generated via gen-proof tool
    const realRangeProof = {
        commitment: { data: [...Buffer.from("fa09dd904eaf2672edafb415542f3b202c294522666451cbafd48c895ad9016d", "hex")] },
        proof: Buffer.from("42013d3369c3514890b74f9066a9406d072975852c3137bc12aabf59b78eda18ce2556a989750c831fe65ef0aa6c8afe13ee1d75e45643320191fb95939e1e0b7657a11342ab6e1901925b6f92fc6c66a96f2d20d427a654e808bc828752bd0b52478a064268bf2d910241bdb2a586c7efa063b0d00972fdceca4c61ddf703266308c6bd4c6c3d2c2cb0e441fdb42f6deb266123184a081b1d37580050466f0e76919a45fbc714cdd12e29989c116ec6396be95135bf3ba5ea4602a7729f0d042897515fea0c4327476e7ab9b26f68a3d787ee3c45549b6976316f2c1a67520520102826648b716398573080761be7bdaddeedcf67460cb2c15c7c3deb04c8196881441e714e6a241e474265ade240d02552b262a7e310bc4ce723da8519c50dec3860a9db4e76c2ec913511ebcec842121f9b490622c2d320c43f329a10035e86288c1091e4b704b2ba9187b57e91369997fbaeff2a2fa6b2036258d6e8c53738da546da5c2e879425d52a42285857a298fa35f8043d13be52a3d06a3349169b6057d89be396bdb74fd97af3cac0e6888a243a160b659de96ffb518e4414f19bcdf1d7afba422093c7babfa67fd4512d943c9411eab69c231c63a9372e6d0008498f3dc4a44cd9eb2f75bbfc14b5db0ad155a331512da0fa549245447d2655f18ff5a6a930b7a655d8f40d97ee2f5caf6ed798bf16ee039132e96e23518650dae6906b72365ef7df4458c92cb5a09e0403de3852022b34bf54ec3056dc25178c6f34e47e01487107a3619ef1b67c4e1f56840468bdb97465ec8eba2d2fdb908d66a9a90406ca974703adcc488f7ae4e409d1ec3db8fbcd174fabdf45d6f1f6b4bbe28c696d75c5d0c7784af36e3c4245f0e10062cc2805978e8585fbefe6c04505dca18627f7d9619917703bdf29af3c5cd0624422f9bfdad43d1466aa71f06", "hex")
    };
    const realTransferProof = {
        amountCommitment: { data: [...Buffer.from("fa09dd904eaf2672edafb415542f3b202c294522666451cbafd48c895ad9016d", "hex")] },
        proof: Buffer.from("8e4669d25b45a50b07b92ac20798c661cb9b8292064edc922ca7be455f522f44b4fc17a24492b2a57cbeb55c44d02385e28bfd80952dea28a7cb9dba4012eb1e5885290619e1d6229b0821dd18b767b9c81d4554e3eada1b3d8123ea3f218c42aa769ecda1dbad6e6c25ba1529e312d764ccb039f70502752c84875092d20d701c5204e7f1ebc3b38965693f39554b34041bda9ff9027cc534687168c9350128760efc543de79c41b3c96811009532da4da80500837d3bdb7eb1c1b173a7e75d760efc543de79c41b3c96811009532da4da80500837d3bdb7eb1c1b173a7e75dd635b3ee2ff86f06a074e636d5c314d6b0edb930ce7fc83ceb9dcf0ce444e42fda404353c92d01473bbca8031af153d638946ec8fa6ed7a5e192aa56ad2613da404353c92d01473bbca8031af153d638946ec8fa6ed7a5e192aa56ad26130eea3e869b5f080db5e098bfddc702525332effb111103a36fdf1663ff5a191d2c0218e257a1113cf7a668027f184fb6a1a307059fd2671883c1f2f87113cb53f8f15bc56047d52e03ef1d9115eaa52f177b80a0e9a10265cdb7e235025b446de6fe10fa5113f635c9b17e8c5bd9896cbc5c2b3175df6cb0ba253518a6dc0d0708f5cf2108a41a8351e0262ac2face5932e80185ef1c1f1de45bc056a8ca5010c0e8c78fcaa0d21a5a4bdedf37894fcb6886889f75e39a48628525f26d02e03192c4aab0dbb8fcb07dfa1b0ca50dfe429ffc24a9f4ae86c5d91cfd3e494938068cd6e2cd20ca13fb116858e1aa4c38b4252d9ca47e13b68addbcbfdd2a4d6907ed4510ddf3aae7390e9266183890e562d2cb9fe0baecd1ac224c596b287df8025ee629511c92e5aa81ce0bbc9fabc1da90cf225b6ac0b12f3574c107fe61c80bd8e9c2250371ebde422298d54b9f3c0338eda26d9ad43525616033d579781713d8e9c2250371ebde422298d54b9f3c0338eda26d9ad43525616033d579781713395710cb20e373d9229c7cd6dd464249c196a2f7c03ed73c77c468001bc7ce04e61e9f610068a62eb78a8e66e863d2ee0ea2c427274ac7a52b5d47fe3fc569077e16b8f8f6925b8ee9b6761cfd397a1799b7b6caa6165f308a1d5f92721b7e205cf6094c72d301f0a64b6612602114f5b45d8ad7109ca65e032f5163579b227796fadbb942dafea0166a7fb30346af4253feacf5efe42cdec2330c6e7952aa6bba7a4e179e38673ff57162977462309f8485af35f829fa264a69801dbd4eaa7b0b0c696668d90a401177f70799d74a7deb29891f8e272869854b9a198857350044685d820e3fc78deb359a7a9417ba18bf59282bf4018cdfef91a79bc68ea0045f24341186bb81cf1721ea65fbb34ef5bfe0b19a1f229116c78d59123415470d7e9cb0535e4cfd6ac9efc3383831760ac1d68ea6d686ebd6cc7642cd3d5a74440251ae229783873366f8ae475ff6cf6c8f96295130b23c297faaeb6fd529330884402f1782f34feef3488e2439e918e62dfd7fc494b6762555f3ee905c1cab722485d273258eeb350b3baab1f88dfcbf98bd37b97902ccc08990805d12797c412abbeeca5d64253f88d1729c8cb152126b3e94dc78bee740036c9d4c3f0fb760deed9670c6fefe7cc18b37b059af162a76a262fb7c0b8ae538a706ec4ac7f27b464d31197706d15241243202e8b849c527d1158accaa71d099605cb54bfe072884fd1b159de2226cf105238ab8f6c68092c0103c0387c2d9cff205e36a177144a201f8f00ced6aff5256c157b0c404d7c05bd59b80b35e00b7262fddaa27ee36e853d6debb22a912db9e5ddd9c372db7632359a6e2a542b66f7c4a88701d481fa6f7b0f04f4331eed7da9101165b5914f2211b37cb67982f995156e25bb8b507669bca590a51bdde98fd2a0848c2b49206327a113985705578c149d2bf686c363468efc55127ec190a379232439e07207ad8dd1a30e98de18e6927766723534f4aec232724e9f7740b5c08fe756416e8634c8d16bacaa1b5addfd217f3446b071c7ea0b83dc14b701c4bbd95e239b966a7dc0d370f363beee5300a2259dc730e0b1dd69f967a3b16f8235de3d5c7653ceab69f314cec3bde797d1ebdd0b7a603", "hex")
    };

    async function createATA(owner: PublicKey, mint: PublicKey, programId: PublicKey) {
        const ata = getAssociatedTokenAddressSync(mint, owner, false, programId);
        const ix = createAssociatedTokenAccountInstruction(authority.publicKey, ata, owner, mint, programId);
        await anchor.web3.sendAndConfirmTransaction(provider.connection, new anchor.web3.Transaction().add(ix), [authority.payer]);
        return ata;
    }

    before(async () => {
        // Airdrops
        for (const kp of [userA, userB]) {
            const sig = await provider.connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
            const latest = await provider.connection.getLatestBlockhash();
            await provider.connection.confirmTransaction({ signature: sig, ...latest });
        }

        // Create Energy Mint (Token 2022)
        energyMint = await createMint(provider.connection, authority.payer, authority.publicKey, null, 9, undefined, undefined, TOKEN_2022_PROGRAM_ID);

        // ATAs
        userA_Token = await createATA(userA.publicKey, energyMint, TOKEN_2022_PROGRAM_ID);
        userB_Token = await createATA(userB.publicKey, energyMint, TOKEN_2022_PROGRAM_ID);

        // Derive Confidential Balance PDAs
        [userA_Confidential] = PublicKey.findProgramAddressSync(
            [Buffer.from("confidential_balance"), userA.publicKey.toBuffer(), energyMint.toBuffer()],
            program.programId
        );
        [userB_Confidential] = PublicKey.findProgramAddressSync(
            [Buffer.from("confidential_balance"), userB.publicKey.toBuffer(), energyMint.toBuffer()],
            program.programId
        );

        // Fund User A with some public energy BEFORE transferring authority
        await mintTo(provider.connection, authority.payer, energyMint, userA_Token, authority.payer, 1000, [], { skipPreflight: true }, TOKEN_2022_PROGRAM_ID);

        // Now Transfer mint authority to the program PDA for unshielding
        const [mintAuth] = PublicKey.findProgramAddressSync(
            [Buffer.from("mint_authority"), energyMint.toBuffer()],
            program.programId
        );
        await setAuthority(provider.connection, authority.payer, energyMint, authority.publicKey, AuthorityType.MintTokens, mintAuth, [], undefined, TOKEN_2022_PROGRAM_ID);
    });

    it("Initializes confidential balance accounts", async () => {
        await program.methods.initializeConfidentialBalance().accounts({
            confidentialBalance: userA_Confidential,
            mint: energyMint,
            owner: userA.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([userA]).rpc();

        await program.methods.initializeConfidentialBalance().accounts({
            confidentialBalance: userB_Confidential,
            mint: energyMint,
            owner: userB.publicKey,
            systemProgram: SystemProgram.programId
        } as any).signers([userB]).rpc();

        const balanceA = await program.account.confidentialBalance.fetch(userA_Confidential);
        assert.ok(balanceA.owner.equals(userA.publicKey));
        assert.equal(balanceA.pendingCredits.toNumber(), 0);
    });

    it("Shields energy tokens (Public -> Confidential)", async () => {
        const amount = new BN(500);
        await program.methods.shieldEnergy(amount, { data: [...mockCiphertext.data] }, realRangeProof).accounts({
            confidentialBalance: userA_Confidential,
            mint: energyMint,
            userTokenAccount: userA_Token,
            owner: userA.publicKey,
            zkTokenProofProgram: ZK_TOKEN_PROOF_PROGRAM_ID,
            tokenProgram: TOKEN_2022_PROGRAM_ID
        } as any).signers([userA]).rpc();

        const tokenBalance = await provider.connection.getTokenAccountBalance(userA_Token);
        assert.equal(tokenBalance.value.amount, "500");

        const confidentialBalance = await program.account.confidentialBalance.fetch(userA_Confidential);
        assert.ok(confidentialBalance.lastUpdateSlot.gtn(0));
    });

    it("Executes a private transfer", async () => {
        const amount = new BN(200);
        await program.methods.privateTransfer(amount, { data: [...mockCiphertext.data] }, realTransferProof).accounts({
            senderBalance: userA_Confidential,
            receiverBalance: userB_Confidential,
            receiverOwner: userB.publicKey,
            mint: energyMint,
            owner: userA.publicKey,
            zkTokenProofProgram: ZK_TOKEN_PROOF_PROGRAM_ID
        } as any).signers([userA]).rpc();

        const balanceA = await program.account.confidentialBalance.fetch(userA_Confidential);
        const balanceB = await program.account.confidentialBalance.fetch(userB_Confidential);

        // Slot should be updated for both
        assert.ok(balanceA.lastUpdateSlot.gtn(0));
        assert.ok(balanceB.lastUpdateSlot.gtn(0));
    });

    it("Unshields energy tokens (Confidential -> Public)", async () => {
        const amount = new BN(100);
        const [mintAuth] = PublicKey.findProgramAddressSync(
            [Buffer.from("mint_authority"), energyMint.toBuffer()],
            program.programId
        );

        await program.methods.unshieldEnergy(amount, { data: [...mockCiphertext.data] }, realTransferProof).accounts({
            confidentialBalance: userB_Confidential,
            mint: energyMint,
            userTokenAccount: userB_Token,
            mintAuthority: mintAuth,
            owner: userB.publicKey,
            zkTokenProofProgram: ZK_TOKEN_PROOF_PROGRAM_ID,
            tokenProgram: TOKEN_2022_PROGRAM_ID
        } as any).signers([userB]).rpc();

        const tokenBalance = await provider.connection.getTokenAccountBalance(userB_Token);
        // User B had 0, now should have 100
        assert.equal(tokenBalance.value.amount, "100");
    });
});
