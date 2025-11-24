/**
 * Creates a Codama configuration object for generating JavaScript clients
 * from Anchor IDL files.
 *
 * @param {Object} options - Configuration options
 * @param {string} options.idl - Path to the IDL file
 * @param {string} options.clientJs - Output directory for the generated JavaScript client
 * @returns {Object} Codama configuration object
 */
export function createCodamaConfig({ idl, clientJs }) {
  return {
    // Use the Anchor IDL directly
    idl,
    // Define a nodes function that converts the Anchor IDL to a Codama IDL
    nodes: async () => {
      const { rootNodeFromAnchor } = await import("@codama/nodes-from-anchor");
      return rootNodeFromAnchor(idl);
    },
    // Define scripts for Codama
    scripts: {
      js: [
        {
          from: "@codama/renderers-js",
          args: [clientJs],
        },
      ],
      rust: [
        {
          from: "@codama/renderers-rust",
          args: [clientJs.replace("/js/", "/rust/")],
        },
      ],
    },
  };
}
