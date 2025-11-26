export type Governance = {
  "address": "4DY97YYBt4bxvG7xaSmWy3MhYhmA6HoMajBHVqhySvXe",
  "metadata": {
    "name": "governance",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Governance program for P2P Energy Trading - Engineering Department administration"
  },
  "instructions": [
    {
      "name": "emergencyPause",
      "docs": [
        "Emergency pause functionality - REC authority only"
      ],
      "discriminator": [
        21,
        143,
        27,
        142,
        200,
        181,
        210,
        255
      ],
      "accounts": [
        {
          "name": "poaConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  97,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "poa_config"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "emergencyUnpause",
      "docs": [
        "Emergency unpause functionality - REC authority only"
      ],
      "discriminator": [
        83,
        249,
        195,
        57,
        206,
        189,
        31,
        85
      ],
      "accounts": [
        {
          "name": "poaConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  97,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "poa_config"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "getGovernanceStats",
      "docs": [
        "Get governance statistics"
      ],
      "discriminator": [
        67,
        29,
        241,
        120,
        15,
        8,
        9,
        16
      ],
      "accounts": [
        {
          "name": "poaConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  97,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [],
      "returns": {
        "defined": {
          "name": "GovernanceStats"
        }
      }
    },
    {
      "name": "initializePoa",
      "docs": [
        "Initialize PoA with single REC authority for ERC certification"
      ],
      "discriminator": [
        98,
        199,
        82,
        10,
        244,
        161,
        157,
        46
      ],
      "accounts": [
        {
          "name": "poaConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  97,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
      "name": "issueErc",
      "docs": [
        "Issue ERC (Energy Renewable Certificate) - REC authority only",
        "This prevents double-claiming by tracking claimed_erc_generation in the meter"
      ],
      "discriminator": [
        174,
        248,
        149,
        107,
        155,
        4,
        196,
        8
      ],
      "accounts": [
        {
          "name": "poaConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  97,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "ercCertificate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  114,
                  99,
                  95,
                  99,
                  101,
                  114,
                  116,
                  105,
                  102,
                  105,
                  99,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "certificate_id"
              }
            ]
          }
        },
        {
          "name": "meterAccount",
          "docs": [
            "Meter account from registry program - tracks claimed ERC generation"
          ],
          "writable": true
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "poa_config"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "certificateId",
          "type": "string"
        },
        {
          "name": "energyAmount",
          "type": "u64"
        },
        {
          "name": "renewableSource",
          "type": "string"
        },
        {
          "name": "validationData",
          "type": "string"
        }
      ]
    },
    {
      "name": "setMaintenanceMode",
      "docs": [
        "Set maintenance mode - Engineering Department only"
      ],
      "discriminator": [
        87,
        100,
        0,
        28,
        116,
        52,
        46,
        40
      ],
      "accounts": [
        {
          "name": "poaConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  97,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "poa_config"
          ]
        }
      ],
      "args": [
        {
          "name": "maintenanceEnabled",
          "type": "bool"
        }
      ]
    },
    {
      "name": "updateAuthorityInfo",
      "docs": [
        "Update authority contact info - Engineering Department only"
      ],
      "discriminator": [
        199,
        12,
        195,
        232,
        185,
        99,
        112,
        145
      ],
      "accounts": [
        {
          "name": "poaConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  97,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "poa_config"
          ]
        }
      ],
      "args": [
        {
          "name": "contactInfo",
          "type": "string"
        }
      ]
    },
    {
      "name": "updateErcLimits",
      "docs": [
        "Update ERC limits - Engineering Department only"
      ],
      "discriminator": [
        235,
        208,
        197,
        149,
        62,
        109,
        254,
        110
      ],
      "accounts": [
        {
          "name": "poaConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  97,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "poa_config"
          ]
        }
      ],
      "args": [
        {
          "name": "minEnergyAmount",
          "type": "u64"
        },
        {
          "name": "maxErcAmount",
          "type": "u64"
        },
        {
          "name": "ercValidityPeriod",
          "type": "i64"
        }
      ]
    },
    {
      "name": "updateGovernanceConfig",
      "docs": [
        "Update governance configuration - Engineering Department only"
      ],
      "discriminator": [
        140,
        45,
        181,
        17,
        77,
        67,
        157,
        248
      ],
      "accounts": [
        {
          "name": "poaConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  97,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "poa_config"
          ]
        }
      ],
      "args": [
        {
          "name": "ercValidationEnabled",
          "type": "bool"
        }
      ]
    },
    {
      "name": "validateErcForTrading",
      "docs": [
        "Validate ERC for trading - REC authority only"
      ],
      "discriminator": [
        9,
        215,
        176,
        63,
        247,
        150,
        72,
        139
      ],
      "accounts": [
        {
          "name": "poaConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  97,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "ercCertificate",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  114,
                  99,
                  95,
                  99,
                  101,
                  114,
                  116,
                  105,
                  102,
                  105,
                  99,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "erc_certificate.certificate_id",
                "account": "ErcCertificate"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "poa_config"
          ]
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "ErcCertificate",
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
      "name": "MeterAccount",
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
      "name": "PoAConfig",
      "discriminator": [
        119,
        6,
        28,
        138,
        199,
        43,
        5,
        184
      ]
    }
  ],
  "events": [
    {
      "name": "AuthorityInfoUpdated",
      "discriminator": [
        228,
        61,
        181,
        210,
        130,
        130,
        77,
        145
      ]
    },
    {
      "name": "EmergencyPauseActivated",
      "discriminator": [
        27,
        50,
        161,
        55,
        240,
        51,
        173,
        218
      ]
    },
    {
      "name": "EmergencyPauseDeactivated",
      "discriminator": [
        90,
        52,
        28,
        232,
        69,
        75,
        68,
        124
      ]
    },
    {
      "name": "ErcIssued",
      "discriminator": [
        61,
        14,
        253,
        164,
        112,
        61,
        180,
        73
      ]
    },
    {
      "name": "ErcLimitsUpdated",
      "discriminator": [
        117,
        248,
        58,
        88,
        196,
        106,
        198,
        200
      ]
    },
    {
      "name": "ErcValidatedForTrading",
      "discriminator": [
        235,
        179,
        22,
        112,
        115,
        143,
        126,
        29
      ]
    },
    {
      "name": "GovernanceConfigUpdated",
      "discriminator": [
        76,
        140,
        190,
        10,
        102,
        221,
        44,
        0
      ]
    },
    {
      "name": "MaintenanceModeUpdated",
      "discriminator": [
        111,
        107,
        239,
        85,
        2,
        133,
        144,
        193
      ]
    },
    {
      "name": "PoAInitialized",
      "discriminator": [
        80,
        195,
        18,
        203,
        105,
        127,
        36,
        126
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
      "name": "AlreadyPaused",
      "msg": "System is already paused"
    },
    {
      "code": 6002,
      "name": "NotPaused",
      "msg": "System is not paused"
    },
    {
      "code": 6003,
      "name": "SystemPaused",
      "msg": "System is currently paused"
    },
    {
      "code": 6004,
      "name": "MaintenanceMode",
      "msg": "System is in maintenance mode"
    },
    {
      "code": 6005,
      "name": "ErcValidationDisabled",
      "msg": "ERC validation is disabled"
    },
    {
      "code": 6006,
      "name": "InvalidErcStatus",
      "msg": "Invalid ERC status"
    },
    {
      "code": 6007,
      "name": "AlreadyValidated",
      "msg": "ERC already validated"
    },
    {
      "code": 6008,
      "name": "BelowMinimumEnergy",
      "msg": "Energy amount below minimum required"
    },
    {
      "code": 6009,
      "name": "ExceedsMaximumEnergy",
      "msg": "Energy amount exceeds maximum allowed"
    },
    {
      "code": 6010,
      "name": "CertificateIdTooLong",
      "msg": "Certificate ID too long"
    },
    {
      "code": 6011,
      "name": "SourceNameTooLong",
      "msg": "Renewable source name too long"
    },
    {
      "code": 6012,
      "name": "ErcExpired",
      "msg": "ERC certificate has expired"
    },
    {
      "code": 6013,
      "name": "InvalidMinimumEnergy",
      "msg": "Invalid minimum energy amount"
    },
    {
      "code": 6014,
      "name": "InvalidMaximumEnergy",
      "msg": "Invalid maximum energy amount"
    },
    {
      "code": 6015,
      "name": "InvalidValidityPeriod",
      "msg": "Invalid validity period"
    },
    {
      "code": 6016,
      "name": "ContactInfoTooLong",
      "msg": "Contact information too long"
    },
    {
      "code": 6017,
      "name": "InvalidOracleConfidence",
      "msg": "Invalid oracle confidence score (must be 0-100)"
    },
    {
      "code": 6018,
      "name": "OracleValidationRequired",
      "msg": "Oracle validation required but not configured"
    },
    {
      "code": 6019,
      "name": "TransfersNotAllowed",
      "msg": "Certificate transfers not allowed"
    },
    {
      "code": 6020,
      "name": "InsufficientUnclaimedGeneration",
      "msg": "Insufficient unclaimed generation for ERC issuance"
    }
  ],
  "types": [
    {
      "name": "AuthorityInfoUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "oldContact",
            "type": "string"
          },
          {
            "name": "newContact",
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
      "name": "EmergencyPauseActivated",
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
      "name": "EmergencyPauseDeactivated",
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
      "name": "ErcCertificate",
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
                "name": "ErcStatus"
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
      "name": "ErcIssued",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "certificateId",
            "type": "string"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "energyAmount",
            "type": "u64"
          },
          {
            "name": "renewableSource",
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
      "name": "ErcLimitsUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "oldMin",
            "type": "u64"
          },
          {
            "name": "newMin",
            "type": "u64"
          },
          {
            "name": "oldMax",
            "type": "u64"
          },
          {
            "name": "newMax",
            "type": "u64"
          },
          {
            "name": "oldValidity",
            "type": "i64"
          },
          {
            "name": "newValidity",
            "type": "i64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "ErcStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Valid"
          },
          {
            "name": "Expired"
          },
          {
            "name": "Revoked"
          },
          {
            "name": "Pending"
          }
        ]
      }
    },
    {
      "name": "ErcValidatedForTrading",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "certificateId",
            "type": "string"
          },
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
      "name": "GovernanceConfigUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "ercValidationEnabled",
            "type": "bool"
          },
          {
            "name": "oldEnabled",
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
      "name": "GovernanceStats",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "totalErcsIssued",
            "type": "u64"
          },
          {
            "name": "totalErcsValidated",
            "type": "u64"
          },
          {
            "name": "totalErcsRevoked",
            "type": "u64"
          },
          {
            "name": "totalEnergyCertified",
            "type": "u64"
          },
          {
            "name": "ercValidationEnabled",
            "type": "bool"
          },
          {
            "name": "emergencyPaused",
            "type": "bool"
          },
          {
            "name": "maintenanceMode",
            "type": "bool"
          },
          {
            "name": "minEnergyAmount",
            "type": "u64"
          },
          {
            "name": "maxErcAmount",
            "type": "u64"
          },
          {
            "name": "ercValidityPeriod",
            "type": "i64"
          },
          {
            "name": "requireOracleValidation",
            "type": "bool"
          },
          {
            "name": "allowCertificateTransfers",
            "type": "bool"
          },
          {
            "name": "delegationEnabled",
            "type": "bool"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "lastUpdated",
            "type": "i64"
          },
          {
            "name": "lastErcIssuedAt",
            "type": {
              "option": "i64"
            }
          }
        ]
      }
    },
    {
      "name": "MaintenanceModeUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "maintenanceEnabled",
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
      "name": "MeterAccount",
      "docs": [
        "MeterAccount from registry program (for CPI validation)",
        "This mirrors the structure in the registry program"
      ],
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
            "type": "u8"
          },
          {
            "name": "status",
            "type": "u8"
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
      "name": "PoAConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Single authority - REC certifying entity"
            ],
            "type": "pubkey"
          },
          {
            "name": "authorityName",
            "docs": [
              "Authority name (e.g., \"REC\")"
            ],
            "type": "string"
          },
          {
            "name": "contactInfo",
            "docs": [
              "Authority contact information"
            ],
            "type": "string"
          },
          {
            "name": "version",
            "docs": [
              "Governance version for upgrades"
            ],
            "type": "u8"
          },
          {
            "name": "emergencyPaused",
            "docs": [
              "Emergency pause status"
            ],
            "type": "bool"
          },
          {
            "name": "emergencyTimestamp",
            "docs": [
              "Emergency pause timestamp"
            ],
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "emergencyReason",
            "docs": [
              "Emergency pause reason"
            ],
            "type": {
              "option": "string"
            }
          },
          {
            "name": "maintenanceMode",
            "docs": [
              "System maintenance mode"
            ],
            "type": "bool"
          },
          {
            "name": "ercValidationEnabled",
            "docs": [
              "Whether ERC validation is enabled"
            ],
            "type": "bool"
          },
          {
            "name": "minEnergyAmount",
            "docs": [
              "Minimum energy amount for ERC issuance (kWh)"
            ],
            "type": "u64"
          },
          {
            "name": "maxErcAmount",
            "docs": [
              "Maximum ERC amount per certificate (kWh)"
            ],
            "type": "u64"
          },
          {
            "name": "ercValidityPeriod",
            "docs": [
              "ERC certificate validity period (seconds)"
            ],
            "type": "i64"
          },
          {
            "name": "autoRevokeExpired",
            "docs": [
              "Auto-revoke expired certificates"
            ],
            "type": "bool"
          },
          {
            "name": "requireOracleValidation",
            "docs": [
              "Require oracle validation for ERC issuance"
            ],
            "type": "bool"
          },
          {
            "name": "delegationEnabled",
            "docs": [
              "Whether the authority can delegate ERC validation"
            ],
            "type": "bool"
          },
          {
            "name": "oracleAuthority",
            "docs": [
              "Oracle authority for AMI data validation"
            ],
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "minOracleConfidence",
            "docs": [
              "Minimum confidence score for oracle validation (0-100)"
            ],
            "type": "u8"
          },
          {
            "name": "allowCertificateTransfers",
            "docs": [
              "Allow certificate transfers between accounts"
            ],
            "type": "bool"
          },
          {
            "name": "totalErcsIssued",
            "docs": [
              "Total ERCs issued since inception"
            ],
            "type": "u64"
          },
          {
            "name": "totalErcsValidated",
            "docs": [
              "Total ERCs validated for trading"
            ],
            "type": "u64"
          },
          {
            "name": "totalErcsRevoked",
            "docs": [
              "Total ERCs revoked"
            ],
            "type": "u64"
          },
          {
            "name": "totalEnergyCertified",
            "docs": [
              "Total energy certified (kWh)"
            ],
            "type": "u64"
          },
          {
            "name": "createdAt",
            "docs": [
              "When governance was initialized"
            ],
            "type": "i64"
          },
          {
            "name": "lastUpdated",
            "docs": [
              "Last configuration update"
            ],
            "type": "i64"
          },
          {
            "name": "lastErcIssuedAt",
            "docs": [
              "Last ERC issued timestamp"
            ],
            "type": {
              "option": "i64"
            }
          }
        ]
      }
    },
    {
      "name": "PoAInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "authorityName",
            "type": "string"
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