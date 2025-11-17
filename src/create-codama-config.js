// Default dependency map for Gill SDK
const DEFAULT_DEPENDENCY_MAP = {
  'gill': 'gill',
  '@solana/addresses': 'gill',
  '@solana/codecs': 'gill',
  '@solana/instructions': 'gill',
  '@solana/rpc-types': 'gill',
  '@solana/transactions': 'gill',
  '@solana/signers': 'gill',
  '@solana/programs': 'gill',
  '@solana/accounts': 'gill',
  '@solana/kit': 'gill',
}

export function createCodamaConfig({ idl, clientJs, dependencyMap = DEFAULT_DEPENDENCY_MAP }) {
  return {
    idl,
    scripts: {
      js: {
        args: [clientJs, { dependencyMap }],
        from: '@codama/renderers-js',
      },
    },
  }
}
