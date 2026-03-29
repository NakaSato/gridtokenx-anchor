const { PublicKey } = require('@solana/web3.js');
const TRADING_PROGRAM_ID = new PublicKey("69dGpKu9a8EZiZ7orgfTH6CoGj9DeQHHkHBF2exSr8na");

const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market")],
    TRADING_PROGRAM_ID
);
console.log(`Market PDA: ${marketPda.toBase58()}`);

const zoneId = 1;
const zoneIdBuffer = Buffer.alloc(4);
zoneIdBuffer.writeUInt32LE(zoneId);
const [zoneMarketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("zone_market"), marketPda.toBuffer(), zoneIdBuffer],
    TRADING_PROGRAM_ID
);
console.log(`Zone Market PDA (Zone 1): ${zoneMarketPda.toBase58()}`);
