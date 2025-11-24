#!/usr/bin/env node

import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { readFile } from "fs/promises";

async function main() {
  try {
    console.log("Reading IDL...");
    const idlContent = await readFile("target/idl/registry.json", "utf8");
    const idl = JSON.parse(idlContent);

    console.log(
      "IDL instructions:",
      JSON.stringify(
        idl.instructions.map((i) => ({ name: i.name, args: i.args })),
        null,
        2,
      ),
    );

    console.log("Processing IDL...");
    const root = await rootNodeFromAnchor("target/idl/registry.json");
    console.log("IDL processed successfully");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
