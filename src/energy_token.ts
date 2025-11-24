/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/energy_token.json`.
 */
export type EnergyToken = {
  "address": "94G1r674LmRDmLN2UPjDFD8Eh7zT8JaSaxv9v68GyEur",
  "metadata": {
    "name": "energyToken",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Energy Token program for P2P Energy Trading - SPL token wrapper"
  },
  "instructions": [
    {
      "name": "addRecValidator",
      "docs": [
        "Add a REC validator to the system"
      ],
      "discriminator": [
        73,
        235,
        183,
        190,
        157,
        85,
        246,
        2
      ],
      "accounts": [
        {
          "name": "tokenInfo",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "tokenInfo"
          ]
        }
      ],
      "args": [
        {
          "name": "validatorPubkey",
          "type": "pubkey"
        },
        {
          "name": "authorityName",
          "type": "string"
        }
      ]
    },
    {
      "name": "burnTokens",
      "docs": [
        "Burn energy tokens (for energy consumption)"
      ],
      "discriminator": [
        76,
        15,
        51,
        254,
        229,
        215,
        121,
        66
      ],
      "accounts": [
        {
          "name": "tokenInfo",
          "writable": true
        },
        {
          "name": "mint",
          "writable": true
        },
        {
          "name": "tokenAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createTokenMint",
      "docs": [
        "Create a new GRX token mint with Token 2022 compatibility"
      ],
      "discriminator": [
        35,
        109,
        237,
        196,
        54,
        218,
        33,
        119
      ],
      "accounts": [
        {
          "name": "mint",
          "writable": true,
          "signer": true
        },
        {
          "name": "metadata",
          "writable": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "metadataProgram"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        },
        {
          "name": "sysvarInstructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "symbol",
          "type": "string"
        },
        {
          "name": "uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "initializeToken",
      "docs": [
        "Initialize the energy token program"
      ],
      "discriminator": [
        38,
        209,
        150,
        50,
        190,
        117,
        16,
        54
      ],
      "accounts": [
        {
          "name": "tokenInfo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  105,
                  110,
                  102,
                  111
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "mintGridTokens",
      "docs": [
        "Mint GRID tokens based on settled meter balance",
        "This function performs CPI to registry to settle the meter balance,",
        "then mints the corresponding GRID tokens to the user"
      ],
      "discriminator": [
        216,
        110,
        76,
        206,
        212,
        49,
        238,
        59
      ],
      "accounts": [
        {
          "name": "tokenInfo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  105,
                  110,
                  102,
                  111
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true
        },
        {
          "name": "meterAccount",
          "writable": true
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "meterOwner",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "registryProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "mintToWallet",
      "docs": [
        "Mint GRX tokens to a wallet using Token interface"
      ],
      "discriminator": [
        17,
        40,
        71,
        107,
        142,
        232,
        163,
        100
      ],
      "accounts": [
        {
          "name": "mint",
          "writable": true
        },
        {
          "name": "destination",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "destinationOwner"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "destinationOwner"
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "mintTokensDirect",
      "docs": [
        "Mint tokens directly to a user (authority only)",
        "This is used for off-chain verified meter readings"
      ],
      "discriminator": [
        13,
        246,
        31,
        237,
        99,
        19,
        88,
        226
      ],
      "accounts": [
        {
          "name": "tokenInfo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  105,
                  110,
                  102,
                  111
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "writable": true
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "transferTokens",
      "docs": [
        "Transfer energy tokens between accounts"
      ],
      "discriminator": [
        54,
        180,
        238,
        175,
        74,
        85,
        126,
        188
      ],
      "accounts": [
        {
          "name": "fromTokenAccount",
          "writable": true
        },
        {
          "name": "toTokenAccount",
          "writable": true
        },
        {
          "name": "fromAuthority",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "tokenInfo",
      "discriminator": [
        109,
        162,
        52,
        125,
        77,
        166,
        37,
        202
      ]
    }
  ],
  "events": [
    {
      "name": "gridTokensMinted",
      "discriminator": [
        178,
        171,
        9,
        157,
        21,
        247,
        211,
        210
      ]
    },
    {
      "name": "tokensMinted",
      "discriminator": [
        207,
        212,
        128,
        194,
        175,
        54,
        64,
        24
      ]
    },
    {
      "name": "tokensMintedDirect",
      "discriminator": [
        251,
        7,
        115,
        163,
        102,
        91,
        61,
        48
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorizedAuthority",
      "msg": "Unauthorized authority"
    },
    {
      "code": 6001,
      "name": "invalidMeter",
      "msg": "Invalid meter"
    },
    {
      "code": 6002,
      "name": "insufficientBalance",
      "msg": "Insufficient token balance"
    },
    {
      "code": 6003,
      "name": "invalidMetadataAccount",
      "msg": "Invalid metadata account"
    },
    {
      "code": 6004,
      "name": "noUnsettledBalance",
      "msg": "No unsettled balance"
    }
  ],
  "types": [
    {
      "name": "gridTokensMinted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "meterOwner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tokenInfo",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "totalSupply",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tokensMinted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tokensMintedDirect",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    }
  ]
};

