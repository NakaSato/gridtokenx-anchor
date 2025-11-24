/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/registry.json`.
 */
export type Registry = {
  "address": "2XPQmFYMdXjP7ffoBB3mXeCdboSFg5Yeb6QmTSGbW8a7",
  "metadata": {
    "name": "registry",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Registry program for P2P Energy Trading - User and meter management"
  },
  "instructions": [
    {
      "name": "getUnsettledBalance",
      "docs": [
        "Calculate unsettled net generation ready for tokenization",
        "This is a view function that returns how much energy can be minted as GRID tokens"
      ],
      "discriminator": [
        178,
        120,
        95,
        9,
        18,
        81,
        181,
        83
      ],
      "accounts": [
        {
          "name": "meterAccount"
        }
      ],
      "args": [],
      "returns": "u64"
    },
    {
      "name": "initialize",
      "docs": [
        "Initialize the registry with REC authority"
      ],
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
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
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
        }
      ],
      "args": []
    },
    {
      "name": "isValidMeter",
      "docs": [
        "Verify if a meter is valid and active"
      ],
      "discriminator": [
        151,
        114,
        52,
        252,
        238,
        233,
        81,
        91
      ],
      "accounts": [
        {
          "name": "meterAccount"
        }
      ],
      "args": [],
      "returns": "bool"
    },
    {
      "name": "isValidUser",
      "docs": [
        "Verify if a user is valid and active"
      ],
      "discriminator": [
        204,
        118,
        77,
        53,
        39,
        63,
        237,
        250
      ],
      "accounts": [
        {
          "name": "userAccount"
        }
      ],
      "args": [],
      "returns": "bool"
    },
    {
      "name": "registerMeter",
      "docs": [
        "Register a smart meter for an existing user"
      ],
      "discriminator": [
        49,
        106,
        87,
        72,
        138,
        214,
        224,
        125
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true
        },
        {
          "name": "userAccount",
          "writable": true
        },
        {
          "name": "meterAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  116,
                  101,
                  114
                ]
              },
              {
                "kind": "arg",
                "path": "meterId"
              }
            ]
          }
        },
        {
          "name": "userAuthority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "meterId",
          "type": "string"
        },
        {
          "name": "meterType",
          "type": {
            "defined": {
              "name": "meterType"
            }
          }
        }
      ]
    },
    {
      "name": "registerUser",
      "docs": [
        "Register a new user in the P2P energy trading system"
      ],
      "discriminator": [
        2,
        241,
        150,
        223,
        99,
        214,
        116,
        97
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true
        },
        {
          "name": "userAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "userAuthority"
              }
            ]
          }
        },
        {
          "name": "userAuthority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "userType",
          "type": {
            "defined": {
              "name": "userType"
            }
          }
        },
        {
          "name": "location",
          "type": "string"
        }
      ]
    },
    {
      "name": "settleMeterBalance",
      "docs": [
        "Settle meter balance and prepare for GRID token minting",
        "This updates the settled_net_generation tracker to prevent double-minting",
        "The actual token minting should be called by the energy_token program"
      ],
      "discriminator": [
        178,
        46,
        241,
        202,
        53,
        99,
        79,
        119
      ],
      "accounts": [
        {
          "name": "meterAccount",
          "writable": true
        },
        {
          "name": "meterOwner",
          "signer": true
        }
      ],
      "args": [],
      "returns": "u64"
    },
    {
      "name": "updateMeterReading",
      "docs": [
        "Update meter reading (for oracles and authorized services)"
      ],
      "discriminator": [
        192,
        220,
        135,
        23,
        89,
        22,
        163,
        130
      ],
      "accounts": [
        {
          "name": "meterAccount",
          "writable": true
        },
        {
          "name": "oracleAuthority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "energyGenerated",
          "type": "u64"
        },
        {
          "name": "energyConsumed",
          "type": "u64"
        },
        {
          "name": "readingTimestamp",
          "type": "i64"
        }
      ]
    },
    {
      "name": "updateUserStatus",
      "docs": [
        "Update user status (admin only)"
      ],
      "discriminator": [
        4,
        129,
        231,
        220,
        216,
        44,
        151,
        55
      ],
      "accounts": [
        {
          "name": "registry"
        },
        {
          "name": "userAccount",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "registry"
          ]
        }
      ],
      "args": [
        {
          "name": "newStatus",
          "type": {
            "defined": {
              "name": "userStatus"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "meterAccount",
      "discriminator": [
        87,
        111,
        139,
        87,
        181,
        20,
        104,
        255
      ]
    },
    {
      "name": "registry",
      "discriminator": [
        47,
        174,
        110,
        246,
        184,
        182,
        252,
        218
      ]
    },
    {
      "name": "userAccount",
      "discriminator": [
        211,
        33,
        136,
        16,
        186,
        110,
        242,
        127
      ]
    }
  ],
  "events": [
    {
      "name": "meterBalanceSettled",
      "discriminator": [
        30,
        26,
        22,
        204,
        7,
        250,
        157,
        33
      ]
    },
    {
      "name": "meterReadingUpdated",
      "discriminator": [
        144,
        152,
        178,
        102,
        206,
        190,
        72,
        172
      ]
    },
    {
      "name": "meterRegistered",
      "discriminator": [
        148,
        168,
        114,
        254,
        79,
        45,
        218,
        143
      ]
    },
    {
      "name": "registryInitialized",
      "discriminator": [
        144,
        138,
        62,
        105,
        58,
        38,
        100,
        177
      ]
    },
    {
      "name": "userRegistered",
      "discriminator": [
        21,
        42,
        216,
        163,
        99,
        51,
        200,
        222
      ]
    },
    {
      "name": "userStatusUpdated",
      "discriminator": [
        215,
        22,
        145,
        98,
        124,
        97,
        11,
        160
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorizedUser",
      "msg": "Unauthorized user"
    },
    {
      "code": 6001,
      "name": "unauthorizedAuthority",
      "msg": "Unauthorized authority"
    },
    {
      "code": 6002,
      "name": "invalidUserStatus",
      "msg": "Invalid user status"
    },
    {
      "code": 6003,
      "name": "invalidMeterStatus",
      "msg": "Invalid meter status"
    },
    {
      "code": 6004,
      "name": "userNotFound",
      "msg": "User not found"
    },
    {
      "code": 6005,
      "name": "meterNotFound",
      "msg": "Meter not found"
    },
    {
      "code": 6006,
      "name": "noUnsettledBalance",
      "msg": "No unsettled balance to tokenize"
    }
  ],
  "types": [
    {
      "name": "meterAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "meterId",
            "type": "string"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "meterType",
            "type": {
              "defined": {
                "name": "meterType"
              }
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "meterStatus"
              }
            }
          },
          {
            "name": "registeredAt",
            "type": "i64"
          },
          {
            "name": "lastReadingAt",
            "type": "i64"
          },
          {
            "name": "totalGeneration",
            "type": "u64"
          },
          {
            "name": "totalConsumption",
            "type": "u64"
          },
          {
            "name": "settledNetGeneration",
            "type": "u64"
          },
          {
            "name": "claimedErcGeneration",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "meterBalanceSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "meterId",
            "type": "string"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "tokensToMint",
            "type": "u64"
          },
          {
            "name": "totalSettled",
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
      "name": "meterReadingUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "meterId",
            "type": "string"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "energyGenerated",
            "type": "u64"
          },
          {
            "name": "energyConsumed",
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
      "name": "meterRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "meterId",
            "type": "string"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "meterType",
            "type": {
              "defined": {
                "name": "meterType"
              }
            }
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "meterStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "inactive"
          },
          {
            "name": "maintenance"
          }
        ]
      }
    },
    {
      "name": "meterType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "solar"
          },
          {
            "name": "wind"
          },
          {
            "name": "battery"
          },
          {
            "name": "grid"
          }
        ]
      }
    },
    {
      "name": "registry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "userCount",
            "type": "u64"
          },
          {
            "name": "meterCount",
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
      "name": "registryInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "userAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "userType",
            "type": {
              "defined": {
                "name": "userType"
              }
            }
          },
          {
            "name": "location",
            "type": "string"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "userStatus"
              }
            }
          },
          {
            "name": "registeredAt",
            "type": "i64"
          },
          {
            "name": "meterCount",
            "type": "u32"
          },
          {
            "name": "createdAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "userRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "userType",
            "type": {
              "defined": {
                "name": "userType"
              }
            }
          },
          {
            "name": "location",
            "type": "string"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "userStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "suspended"
          },
          {
            "name": "inactive"
          }
        ]
      }
    },
    {
      "name": "userStatusUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "oldStatus",
            "type": {
              "defined": {
                "name": "userStatus"
              }
            }
          },
          {
            "name": "newStatus",
            "type": {
              "defined": {
                "name": "userStatus"
              }
            }
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "userType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "prosumer"
          },
          {
            "name": "consumer"
          }
        ]
      }
    }
  ]
};

