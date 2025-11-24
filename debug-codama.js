import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { resolve } from "path";

async function main() {
  const idlPath = resolve("target/idl/registry.json");
  console.log("Reading IDL from:", idlPath);

  try {
    const node = await rootNodeFromAnchor(idlPath);

    // Find the program node (it might be the root or a child)
    // rootNodeFromAnchor returns a RootNode which has programs
    const program = node.programs[0];
    console.log("Program:", program.name);

    const instruction = program.instructions.find(i => i.name === "registerMeter");

    if (instruction) {
      console.log("Instruction found:", instruction.name);
      console.log("Arguments:", instruction.arguments.map(a => a.name));

      const meterAccount = instruction.accounts.find(a => a.name === "meterAccount");
      if (meterAccount) {
        console.log("Meter Account Seeds:", JSON.stringify(meterAccount.seeds, null, 2));
      } else {
        console.log("Meter Account not found");
      }
    } else {
      console.log("Instruction registerMeter not found");
      console.log("Available instructions:", program.instructions.map(i => i.name));
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
