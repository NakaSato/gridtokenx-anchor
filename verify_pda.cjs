const { PublicKey } = require("@solana/web3.js");

const programId = new PublicKey("GHoWp5RcujaeqimAAf9RwyRQCCF23mXxVYX9iGwBYGrH");
const [pda, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("token_info")],
  programId
);

console.log("Token Info PDA:", pda.toString());
