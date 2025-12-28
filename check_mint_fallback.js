
import { PublicKey } from '@solana/web3.js';

const programId = "5FVExLSAC94gSWH6TJa1TmBDWXuqFe5obZaC5DkqJihU";
const [mintPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint")],
    new PublicKey(programId)
);

console.log("Program ID:", programId);
console.log("Derived Mint PDA:", mintPda.toBase58());
console.log("Bump:", bump);
