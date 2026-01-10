import { PublicKey } from "@solana/web3.js";

const newProgId = new PublicKey("5FVExLSAC94gSWH6TJa1TmBDWXuqFe5obZaC5DkqJihU");
const oldProgId = new PublicKey("54SAVMgGhjssp3iQ7zBK8kgUnEtqHJTNg3QRfzzDitHB");

console.log("5FVEx PDA:", PublicKey.findProgramAddressSync([Buffer.from("mint")], newProgId)[0].toBase58());
console.log("54SAV PDA:", PublicKey.findProgramAddressSync([Buffer.from("mint")], oldProgId)[0].toBase58());
