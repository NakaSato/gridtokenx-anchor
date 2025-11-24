// Codama configuration for Registry program
import { createCodamaConfig } from "./src/create-codama-config.js";

// Direct configuration instead of using createCodamaConfig
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";

export default {
  // Use the Anchor IDL directly
  idl: "/Users/chanthawat/Developments/weekend/gridtokenx-anchor/target/idl/registry.json",
  // Define a nodes function that converts the Anchor IDL to a Codama IDL
  nodes: async () => {
    return await rootNodeFromAnchor(
      "/Users/chanthawat/Developments/weekend/gridtokenx-anchor/target/idl/registry.json",
    );
  },
  // Define scripts for Codama
  scripts: {
    js: [
      {
        from: "@codama/renderers-js",
        args: ["anchor/src/client/js/registry"],
      },
    ],
    rust: [
      {
        from: "@codama/renderers-rust",
        args: ["anchor/src/client/rust/registry"],
      },
    ],
  },
};
