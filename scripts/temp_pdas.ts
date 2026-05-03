import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

const REGISTRY_ID = new PublicKey("7JsfJPuJvhkY376RAzQExbdFbZMgdGc2cWLic25SE1tq");
const ENERGY_TOKEN_ID = new PublicKey("FC28Av9roMDjx5PHH7GkSQQB6qo1vi4jsXR4ymiaV4CW");
const TRADING_ID = new PublicKey("HHAG2cG6sGHTWFwiEh1HBgfqZJWBbnsYzv4f5KtHavUr");
const ORACLE_ID = new PublicKey("9XqNt1FqeKyhh4jBaagBSDUpJSMJhEy5gi8E5xx2RaeY");
const GOVERNANCE_ID = new PublicKey("Czz3aK3CmJfTVJJYDkuu3DcCGfWmuBruC4gbKTqDeq9x");

const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    REGISTRY_ID
);

const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market")],
    TRADING_ID
);

const [mintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_2022")],
    ENERGY_TOKEN_ID
);

console.log(`REGISTRY_PDA=${registryPda.toBase58()}`);
console.log(`MARKET_PDA=${marketPda.toBase58()}`);
console.log(`ENERGY_TOKEN_MINT=${mintPda.toBase58()}`);
console.log(`REGISTRY_PROGRAM_ID=${REGISTRY_ID.toBase58()}`);
console.log(`ENERGY_TOKEN_PROGRAM_ID=${ENERGY_TOKEN_ID.toBase58()}`);
console.log(`TRADING_PROGRAM_ID=${TRADING_ID.toBase58()}`);
console.log(`ORACLE_PROGRAM_ID=${ORACLE_ID.toBase58()}`);
console.log(`GOVERNANCE_PROGRAM_ID=${GOVERNANCE_ID.toBase58()}`);
