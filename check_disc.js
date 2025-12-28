
import { createHash } from 'crypto';

const name = "global:burn";
const hash = createHash('sha256').update(name).digest();
const discriminator = hash.slice(0, 8);

console.log("Name:", name);
console.log("Discriminator (Hex):", discriminator.toString('hex'));
console.log("Discriminator (Decimal):", Array.from(discriminator).join(', '));
