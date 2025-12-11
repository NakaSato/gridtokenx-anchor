import { PublicKey } from "@solana/web3.js";
const programId = new PublicKey("9t3s8sCgVUG9kAgVPsozj8mDpJp9cy6SF5HwRK5nvAHb");
const [pda] = PublicKey.findProgramAddressSync([Buffer.from("market")], programId);
console.log(pda.toString());
