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
      "name": "addBackupOracle",
      "docs": [
        "Add backup oracle (admin only)"
      ],
      "discriminator": [
        143,
        248,
        19,
        210,
        83,
        36,
        71,
        207
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
            "oracle_data"
          ]
        }
      ],
      "args": [
        {
          "name": "backupOracle",
          "type": "pubkey"
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
            "oracle_data"
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
            "oracle_data"
          ]
        }
      ],
      "args": [
        {
          "name": "active",
          "type": "bool"
        }
      ]
    },
    {
      "name": "updateValidationConfig",
      "docs": [
        "Update validation configuration (admin only)"
      ],
      "discriminator": [
        104,
        236,
        139,
        255,
        81,
        213,
        77,
        45
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
            "oracle_data"
          ]
        }
      ],
      "args": [
        {
          "name": "config",
          "type": {
            "defined": {
              "name": "ValidationConfig"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "OracleData",
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
      "name": "ApiGatewayUpdated",
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
      "name": "BackupOracleAdded",
      "discriminator": [
        67,
        221,
        198,
        96,
        194,
        217,
        21,
        22
      ]
    },
    {
      "name": "MarketClearingTriggered",
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
      "name": "MeterReadingSubmitted",
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
      "name": "OracleStatusUpdated",
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
    },
    {
      "name": "ValidationConfigUpdated",
      "discriminator": [
        125,
        139,
        159,
        198,
        160,
        218,
        9,
        122
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "UnauthorizedAuthority",
      "msg": "Unauthorized authority"
    },
    {
      "code": 6001,
      "name": "UnauthorizedGateway",
      "msg": "Unauthorized API Gateway"
    },
    {
      "code": 6002,
      "name": "OracleInactive",
      "msg": "Oracle is inactive"
    },
    {
      "code": 6003,
      "name": "InvalidMeterReading",
      "msg": "Invalid meter reading"
    },
    {
      "code": 6004,
      "name": "MarketClearingInProgress",
      "msg": "Market clearing in progress"
    },
    {
      "code": 6005,
      "name": "EnergyValueOutOfRange",
      "msg": "Energy value out of range"
    },
    {
      "code": 6006,
      "name": "AnomalousReading",
      "msg": "Anomalous reading detected"
    },
    {
      "code": 6007,
      "name": "MaxBackupOraclesReached",
      "msg": "Maximum backup oracles reached"
    }
  ],
  "types": [
    {
      "name": "ApiGatewayUpdated",
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
      "name": "BackupOracleAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "backupOracle",
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
      "name": "MarketClearingTriggered",
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
      "name": "MeterReadingSubmitted",
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
      "name": "OracleData",
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
          },
          {
            "name": "validationConfig",
            "type": {
              "defined": {
                "name": "ValidationConfig"
              }
            }
          },
          {
            "name": "qualityMetrics",
            "type": {
              "defined": {
                "name": "QualityMetrics"
              }
            }
          },
          {
            "name": "backupOracles",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "consensusThreshold",
            "type": "u8"
          },
          {
            "name": "lastConsensusTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "OracleStatusUpdated",
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
    },
    {
      "name": "QualityMetrics",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "totalValidReadings",
            "type": "u64"
          },
          {
            "name": "totalRejectedReadings",
            "type": "u64"
          },
          {
            "name": "averageReadingInterval",
            "type": "u32"
          },
          {
            "name": "lastQualityScore",
            "type": "u8"
          },
          {
            "name": "qualityScoreUpdatedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "ValidationConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "minEnergyValue",
            "type": "u64"
          },
          {
            "name": "maxEnergyValue",
            "type": "u64"
          },
          {
            "name": "anomalyDetectionEnabled",
            "type": "bool"
          },
          {
            "name": "maxReadingDeviationPercent",
            "type": "u16"
          },
          {
            "name": "requireConsensus",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "ValidationConfigUpdated",
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
    }
  ]
};