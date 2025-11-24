#!/usr/bin/env node

import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { renderVisitor as rustRenderVisitor } from "@codama/renderers-rust";
import { visit } from "@codama/visitors-core";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";

const IDL_PATH =
  "/Users/chanthawat/Developments/weekend/gridtokenx-anchor/target/idl/registry.json";
const JS_OUTPUT_DIR =
  "/Users/chanthawat/Developments/weekend/gridtokenx-anchor/anchor/src/client/js/registry";
const RUST_OUTPUT_DIR =
  "/Users/chanthawat/Developments/weekend/gridtokenx-anchor/anchor/src/client/rust/registry";

async function generateClient(type) {
  try {
    console.log(`Processing IDL for ${type} client...`);

    // Create root node from IDL
    const root = await rootNodeFromAnchor(IDL_PATH);
    console.log("IDL processed successfully");

    // Determine output directory and renderer based on type
    const outputDir = type === "js" ? JS_OUTPUT_DIR : RUST_OUTPUT_DIR;
    const renderer = type === "js" ? renderVisitor() : rustRenderVisitor();

    // Create output directory
    mkdirSync(outputDir, { recursive: true });

    // Visit and generate the client
    console.log(`Generating ${type} client...`);
    visit(root, renderer);

    // Write all generated files
    if (renderer.files) {
      for (const [filePath, content] of Object.entries(renderer.files)) {
        const fullPath = path.join(outputDir, filePath);

        // Create subdirectories if needed
        const dir = path.dirname(fullPath);
        mkdirSync(dir, { recursive: true });

        console.log(`Writing file: ${fullPath}`);
        writeFileSync(fullPath, content);
      }
    }

    console.log(`${type} client generated successfully!`);
  } catch (error) {
    console.error(`Error generating ${type} client:`, error);
    process.exit(1);
  }
}

// Main function
async function main() {
  const type = process.argv[2];

  if (!type || (type !== "js" && type !== "rust")) {
    console.error('Please specify client type: "js" or "rust"');
    process.exit(1);
  }

  await generateClient(type);
}

// Run the script
main();
