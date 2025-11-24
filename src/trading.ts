/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/trading.json`.
 */
export type Trading = {
  "address": "GZnqNTJsre6qB4pWCQRE9FiJU2GUeBtBDPp6s7zosctk",
  "metadata": {
    "name": "trading",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Trading program for P2P Energy Trading - Order book and marketplace"
  },
  "instructions": [
    {
      "name": "cancelOrder",
      "docs": [
        "Cancel an active order"
      ],
      "discriminator": [
        95,
        129,
        237,
        240,
        8,
        49,
        223,
        132
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "order",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "createBuyOrder",
      "docs": [
        "Create a buy order for energy"
      ],
      "discriminator": [
        182,
        87,
        0,
        160,
        192,
        66,
        151,
        130
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              },
              {
                "kind": "account",
                "path": "market.active_orders",
                "account": "market"
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
      "args": [
        {
          "name": "energyAmount",
          "type": "u64"
        },
        {
          "name": "maxPricePerKwh",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createSellOrder",
      "docs": [
        "Create a sell order for energy",
        "Validates that the seller has a valid ERC certificate before allowing the order"
      ],
      "discriminator": [
        53,
        52,
        255,
        44,
        191,
        74,
        171,
        225
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              },
              {
                "kind": "account",
                "path": "market.active_orders",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "ercCertificate",
          "docs": [
            "Optional: ERC certificate for prosumers",
            "When provided, validates the seller has certified renewable energy"
          ],
          "optional": true
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
      "args": [
        {
          "name": "energyAmount",
          "type": "u64"
        },
        {
          "name": "pricePerKwh",
          "type": "u64"
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
      "name": "initializeMarket",
      "docs": [
        "Initialize the trading market"
      ],
      "discriminator": [
        35,
        35,
        189,
        193,
        155,
        48,
        170,
        203
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
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
        }
      ],
      "args": []
    },
    {
      "name": "matchOrders",
      "docs": [
        "Match a buy order with a sell order"
      ],
      "discriminator": [
        17,
        1,
        201,
        93,
        7,
        51,
        251,
        134
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "buyOrder",
          "writable": true
        },
        {
          "name": "sellOrder",
          "writable": true
        },
        {
          "name": "tradeRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  100,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "buyOrder"
              },
              {
                "kind": "account",
                "path": "sellOrder"
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
      "args": [
        {
          "name": "matchAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateMarketParams",
      "docs": [
        "Update market parameters (admin only)"
      ],
      "discriminator": [
        70,
        117,
        202,
        191,
        205,
        174,
        92,
        82
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "market"
          ]
        }
      ],
      "args": [
        {
          "name": "marketFeeBps",
          "type": "u16"
        },
        {
          "name": "clearingEnabled",
          "type": "bool"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "ercCertificate",
      "discriminator": [
        83,
        161,
        134,
        16,
        240,
        92,
        186,
        157
      ]
    },
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "order",
      "discriminator": [
        134,
        173,
        223,
        185,
        77,
        86,
        28,
        51
      ]
    },
    {
      "name": "tradeRecord",
      "discriminator": [
        150,
        248,
        182,
        169,
        229,
        100,
        24,
        37
      ]
    }
  ],
  "events": [
    {
      "name": "buyOrderCreated",
      "discriminator": [
        110,
        19,
        133,
        233,
        185,
        79,
        4,
        170
      ]
    },
    {
      "name": "marketInitialized",
      "discriminator": [
        134,
        160,
        122,
        87,
        50,
        3,
        255,
        81
      ]
    },
    {
      "name": "marketParamsUpdated",
      "discriminator": [
        88,
        163,
        120,
        117,
        160,
        118,
        99,
        60
      ]
    },
    {
      "name": "orderCancelled",
      "discriminator": [
        108,
        56,
        128,
        68,
        168,
        113,
        168,
        239
      ]
    },
    {
      "name": "orderMatched",
      "discriminator": [
        211,
        0,
        178,
        174,
        61,
        245,
        45,
        250
      ]
    },
    {
      "name": "sellOrderCreated",
      "discriminator": [
        24,
        91,
        248,
        209,
        136,
        163,
        239,
        240
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
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6002,
      "name": "invalidPrice",
      "msg": "Invalid price"
    },
    {
      "code": 6003,
      "name": "inactiveSellOrder",
      "msg": "Inactive sell order"
    },
    {
      "code": 6004,
      "name": "inactiveBuyOrder",
      "msg": "Inactive buy order"
    },
    {
      "code": 6005,
      "name": "priceMismatch",
      "msg": "Price mismatch"
    },
    {
      "code": 6006,
      "name": "orderNotCancellable",
      "msg": "Order not cancellable"
    },
    {
      "code": 6007,
      "name": "insufficientEscrowBalance",
      "msg": "Insufficient escrow balance"
    },
    {
      "code": 6008,
      "name": "invalidErcCertificate",
      "msg": "Invalid ERC certificate status"
    },
    {
      "code": 6009,
      "name": "ercCertificateExpired",
      "msg": "ERC certificate has expired"
    },
    {
      "code": 6010,
      "name": "ercNotValidatedForTrading",
      "msg": "ERC certificate not validated for trading"
    },
    {
      "code": 6011,
      "name": "exceedsErcAmount",
      "msg": "Order amount exceeds available ERC certificate amount"
    }
  ],
  "types": [
    {
      "name": "buyOrderCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "orderId",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "pricePerKwh",
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
      "name": "ercCertificate",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "certificateId",
            "docs": [
              "Unique certificate identifier"
            ],
            "type": "string"
          },
          {
            "name": "authority",
            "docs": [
              "Issuing authority (Engineering Department)"
            ],
            "type": "pubkey"
          },
          {
            "name": "energyAmount",
            "docs": [
              "Amount of renewable energy (kWh)"
            ],
            "type": "u64"
          },
          {
            "name": "renewableSource",
            "docs": [
              "Source of renewable energy (solar, wind, etc.)"
            ],
            "type": "string"
          },
          {
            "name": "validationData",
            "docs": [
              "Additional validation data"
            ],
            "type": "string"
          },
          {
            "name": "issuedAt",
            "docs": [
              "When the certificate was issued"
            ],
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "docs": [
              "When the certificate expires"
            ],
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "status",
            "docs": [
              "Current status of the certificate"
            ],
            "type": {
              "defined": {
                "name": "ercStatus"
              }
            }
          },
          {
            "name": "validatedForTrading",
            "docs": [
              "Whether validated for trading"
            ],
            "type": "bool"
          },
          {
            "name": "tradingValidatedAt",
            "docs": [
              "When validated for trading"
            ],
            "type": {
              "option": "i64"
            }
          }
        ]
      }
    },
    {
      "name": "ercStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "valid"
          },
          {
            "name": "expired"
          },
          {
            "name": "revoked"
          },
          {
            "name": "pending"
          }
        ]
      }
    },
    {
      "name": "market",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "activeOrders",
            "type": "u64"
          },
          {
            "name": "totalVolume",
            "type": "u64"
          },
          {
            "name": "totalTrades",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "clearingEnabled",
            "type": "bool"
          },
          {
            "name": "marketFeeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "marketInitialized",
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
      "name": "marketParamsUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "marketFeeBps",
            "type": "u16"
          },
          {
            "name": "clearingEnabled",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "order",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "filledAmount",
            "type": "u64"
          },
          {
            "name": "pricePerKwh",
            "type": "u64"
          },
          {
            "name": "orderType",
            "type": {
              "defined": {
                "name": "orderType"
              }
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "orderStatus"
              }
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "orderCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "orderId",
            "type": "pubkey"
          },
          {
            "name": "user",
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
      "name": "orderMatched",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sellOrder",
            "type": "pubkey"
          },
          {
            "name": "buyOrder",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "totalValue",
            "type": "u64"
          },
          {
            "name": "feeAmount",
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
      "name": "orderStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "partiallyFilled"
          },
          {
            "name": "completed"
          },
          {
            "name": "cancelled"
          },
          {
            "name": "expired"
          }
        ]
      }
    },
    {
      "name": "orderType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "sell"
          },
          {
            "name": "buy"
          }
        ]
      }
    },
    {
      "name": "sellOrderCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "orderId",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "pricePerKwh",
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
      "name": "tradeRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sellOrder",
            "type": "pubkey"
          },
          {
            "name": "buyOrder",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "pricePerKwh",
            "type": "u64"
          },
          {
            "name": "totalValue",
            "type": "u64"
          },
          {
            "name": "feeAmount",
            "type": "u64"
          },
          {
            "name": "executedAt",
            "type": "i64"
          }
        ]
      }
    }
  ]
};

