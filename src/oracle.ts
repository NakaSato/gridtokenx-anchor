/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/oracle.json`.
 */
export type Oracle = {
  "address": "DvdtU4quEbuxUY2FckmvcXwTpC9qp4HLJKb1PMLaqAoE",
  "metadata": {
    "name": "oracle",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Oracle program for P2P Energy Trading - AMI data bridge"
  },
  "instructions": [
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
          "name": "oracleData",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  99,
                  108,
                  101,
                  95,
                  100,
                  97,
                  116,
                  97
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
      "args": [
        {
          "name": "apiGateway",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "submitMeterReading",
      "docs": [
        "Submit meter reading data from AMI (only via API Gateway)"
      ],
      "discriminator": [
        181,
        247,
        196,
        139,
        78,
        88,
        192,
        206
      ],
      "accounts": [
        {
          "name": "oracleData",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "meterId",
          "type": "string"
        },
        {
          "name": "energyProduced",
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
      "name": "triggerMarketClearing",
      "docs": [
        "Trigger market clearing process (only via API Gateway)"
      ],
      "discriminator": [
        180,
        116,
        162,
        167,
        37,
        28,
        78,
        159
      ],
      "accounts": [
        {
          "name": "oracleData",
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
      "name": "updateApiGateway",
      "docs": [
        "Update API Gateway address (admin only)"
      ],
      "discriminator": [
        66,
        69,
        252,
        242,
        127,
        168,
        42,
        112
      ],
      "accounts": [
        {
          "name": "oracleData",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "oracleData"
          ]
        }
      ],
      "args": [
        {
          "name": "newApiGateway",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "updateOracleStatus",
      "docs": [
        "Update oracle status (admin only)"
      ],
      "discriminator": [
        17,
        18,
        199,
        125,
        53,
        122,
        91,
        63
      ],
      "accounts": [
        {
          "name": "oracleData",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "oracleData"
          ]
        }
      ],
      "args": [
        {
          "name": "active",
          "type": "bool"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "oracleData",
      "discriminator": [
        26,
        131,
        25,
        110,
        6,
        141,
        10,
        37
      ]
    }
  ],
  "events": [
    {
      "name": "apiGatewayUpdated",
      "discriminator": [
        122,
        57,
        18,
        102,
        98,
        33,
        212,
        171
      ]
    },
    {
      "name": "marketClearingTriggered",
      "discriminator": [
        84,
        174,
        148,
        37,
        4,
        96,
        222,
        120
      ]
    },
    {
      "name": "meterReadingSubmitted",
      "discriminator": [
        116,
        23,
        180,
        91,
        180,
        227,
        160,
        141
      ]
    },
    {
      "name": "oracleStatusUpdated",
      "discriminator": [
        161,
        176,
        98,
        141,
        201,
        86,
        75,
        122
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
      "name": "unauthorizedGateway",
      "msg": "Unauthorized API Gateway"
    },
    {
      "code": 6002,
      "name": "oracleInactive",
      "msg": "Oracle is inactive"
    },
    {
      "code": 6003,
      "name": "invalidMeterReading",
      "msg": "Invalid meter reading"
    },
    {
      "code": 6004,
      "name": "marketClearingInProgress",
      "msg": "Market clearing in progress"
    }
  ],
  "types": [
    {
      "name": "apiGatewayUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "oldGateway",
            "type": "pubkey"
          },
          {
            "name": "newGateway",
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
      "name": "marketClearingTriggered",
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
      "name": "meterReadingSubmitted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "meterId",
            "type": "string"
          },
          {
            "name": "energyProduced",
            "type": "u64"
          },
          {
            "name": "energyConsumed",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "submitter",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "oracleData",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "apiGateway",
            "type": "pubkey"
          },
          {
            "name": "totalReadings",
            "type": "u64"
          },
          {
            "name": "lastReadingTimestamp",
            "type": "i64"
          },
          {
            "name": "lastClearing",
            "type": "i64"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "createdAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "oracleStatusUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "active",
            "type": "bool"
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

