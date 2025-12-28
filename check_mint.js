
import { PublicKey } from '@solana/web3.js';

const programId = "HaT3koMseafcCB9aUQUCrSLMDfN1km7Xik9UhZSG9UV6";
const [mintPda, mintBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint")],
    new PublicKey(programId)
);
const [tokenInfoPda, tokenInfoBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_info")],
    new PublicKey(programId)
);

console.log("Program ID:", programId);
console.log("Derived Mint PDA:", mintPda.toBase58());
console.log("Derived Token Info PDA:", tokenInfoPda.toBase58());
