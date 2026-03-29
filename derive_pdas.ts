import { PublicKey } from "@solana/web3.js";

const REGISTRY_PROGRAM_ID = new PublicKey("Dsgt9aLA4i9DpCGrS826ZGFYiQ52d8qxtFz6TmrTzVW2");
const TRADING_PROGRAM_ID = new PublicKey("5yakTtiNHXHonCPqkwh1M22jujqugCJhEkYaHAoaB6pG");
const GOVERNANCE_PROGRAM_ID = new PublicKey("CHwkxMjTH2dvLSuqmY1mGNd4RGJPrdteSNpMmmsVGv8J");

const [registryPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("registry")],
  REGISTRY_PROGRAM_ID
);

const [marketPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("market")],
  TRADING_PROGRAM_ID
);

const [poaConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("poa_config")],
  GOVERNANCE_PROGRAM_ID
);

console.log(`REGISTRY_PDA=${registryPda.toBase58()}`);
console.log(`MARKET_PDA=${marketPda.toBase58()}`);
console.log(`POA_CONFIG_PDA=${poaConfigPda.toBase58()}`);
