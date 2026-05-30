const { sha256 } = require("js-sha256");

const name = "PoAConfig";
const hash = sha256.digest("account:" + name);
const discriminator = Buffer.from(hash.slice(0, 8)).toString("hex");

console.log("Discriminator for PoAConfig:", discriminator);
