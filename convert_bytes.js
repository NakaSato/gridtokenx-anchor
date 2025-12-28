
import { PublicKey } from '@solana/web3.js';

const bytes = Buffer.from("efb36da36be9cd9e6f90601d4051fe59c5b78daefd38cc66fab9d1a1ba364926", "hex");
console.log("Authority:", new PublicKey(bytes).toBase58());
