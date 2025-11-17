import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";

describe("Governance Program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Governance as any;

  let poaConfigPda: anchor.web3.PublicKey;
  let poaConfigBump: number;

  before(async () => {
    [poaConfigPda, poaConfigBump] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("poa_config")],
      program.programId
    );
  });

  describe("Initialize PoA", () => {
    it("should initialize PoA governance successfully", async () => {
      const tx = await program.methods
        .initializePoa()
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      // Verify PoA was initialized
      const poaConfig = await program.account.poAConfig.fetch(poaConfigPda) as any;
      expect(poaConfig.authority.toString()).to.equal(provider.wallet.publicKey.toString());
      expect(poaConfig.authorityName).to.equal("University Engineering Department");
      expect(poaConfig.contactInfo).to.equal("engineering_erc@utcc.ac.th");
      expect(poaConfig.emergencyPaused).to.be.false;
      expect(poaConfig.ercValidationEnabled).to.be.true;
      expect(poaConfig.maintenanceMode).to.be.false;
      expect(poaConfig.maxErcAmount.toNumber()).to.equal(1_000_000);
      expect(poaConfig.minEnergyAmount.toNumber()).to.equal(100);
      expect(poaConfig.totalErcsIssued.toNumber()).to.equal(0);
      expect(poaConfig.totalErcsValidated.toNumber()).to.equal(0);
      expect(poaConfig.createdAt.toNumber()).to.be.greaterThan(0);
    });
  });

  describe("Emergency Control", () => {
    it("should activate emergency pause", async () => {
      const tx = await program.methods
        .emergencyPause()
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      // Verify emergency pause was activated
      const poaConfig = await program.account.poAConfig.fetch(poaConfigPda) as any;
      expect(poaConfig.emergencyPaused).to.be.true;
      expect(poaConfig.emergencyTimestamp).to.not.be.null;
    });

    it("should deactivate emergency pause", async () => {
      const tx = await program.methods
        .emergencyUnpause()
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      // Verify emergency pause was deactivated
      const poaConfig = await program.account.poAConfig.fetch(poaConfigPda) as any;
      expect(poaConfig.emergencyPaused).to.be.false;
      expect(poaConfig.emergencyTimestamp).to.be.null;
    });

    it("should reject pause activation from unauthorized user", async () => {
      const unauthorizedKeypair = anchor.web3.Keypair.generate();

      try {
        await program.methods
          .emergencyPause()
          .accounts({
            poaConfig: poaConfigPda,
            authority: unauthorizedKeypair.publicKey,
          })
          .signers([unauthorizedKeypair])
          .rpc();

        throw new Error("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("UnauthorizedAuthority");
      }
    });

    it("should reject double pause", async () => {
      // First pause
      await program.methods
        .emergencyPause()
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      // Try to pause again
      try {
        await program.methods
          .emergencyPause()
          .accounts({
            poaConfig: poaConfigPda,
            authority: provider.wallet.publicKey,
          })
          .rpc();

        throw new Error("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("AlreadyPaused");
      }

      // Unpause for other tests
      await program.methods
        .emergencyUnpause()
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
    });
  });

  describe("ERC Issuance", () => {
    let ercCertificatePda: anchor.web3.PublicKey;
    const certificateId = "ERC_2024_001";
    const energyAmount = 5000;
    const renewableSource = "Solar Farm Alpha";
    const validationData = "Validated by Engineering Dept";

    before(async () => {
      [ercCertificatePda] = await anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("erc_certificate"), Buffer.from(certificateId)],
        program.programId
      );
    });

    it("should issue a new ERC certificate", async () => {
      const tx = await program.methods
        .issueErc(
          certificateId,
          new anchor.BN(energyAmount),
          renewableSource,
          validationData
        )
        .accounts({
          poaConfig: poaConfigPda,
          ercCertificate: ercCertificatePda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      // Verify ERC was issued
      const ercCertificate = await program.account.ercCertificate.fetch(ercCertificatePda) as any;
      expect(ercCertificate.certificateId).to.equal(certificateId);
      expect(ercCertificate.energyAmount.toNumber()).to.equal(energyAmount);
      expect(ercCertificate.renewableSource).to.equal(renewableSource);
      expect(ercCertificate.validationData).to.equal(validationData);
      expect(ercCertificate.status).to.have.property("valid");
      expect(ercCertificate.validatedForTrading).to.be.false;
      expect(ercCertificate.issuedAt.toNumber()).to.be.greaterThan(0);

      // Verify counter was incremented
      const poaConfig = await program.account.poAConfig.fetch(poaConfigPda) as any;
      expect(poaConfig.totalErcsIssued.toNumber()).to.be.greaterThan(0);
    });

    it("should reject ERC issuance below minimum energy", async () => {
      const belowMinimumCertificateId = "ERC_2024_002";
      const [belowMinimumPda] = await anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("erc_certificate"), Buffer.from(belowMinimumCertificateId)],
        program.programId
      );

      try {
        await program.methods
          .issueErc(
            belowMinimumCertificateId,
            new anchor.BN(50), // Below minimum of 100
            "Solar",
            "Validation data"
          )
          .accounts({
            poaConfig: poaConfigPda,
            ercCertificate: belowMinimumPda,
            authority: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();

        throw new Error("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("BelowMinimumEnergy");
      }
    });

    it("should reject ERC issuance exceeding maximum energy", async () => {
      const exceedingMaximumCertificateId = "ERC_2024_003";
      const [exceedingMaximumPda] = await anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("erc_certificate"), Buffer.from(exceedingMaximumCertificateId)],
        program.programId
      );

      try {
        await program.methods
          .issueErc(
            exceedingMaximumCertificateId,
            new anchor.BN(2_000_000), // Exceeds maximum of 1_000_000
            "Wind",
            "Validation data"
          )
          .accounts({
            poaConfig: poaConfigPda,
            ercCertificate: exceedingMaximumPda,
            authority: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();

        throw new Error("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("ExceedsMaximumEnergy");
      }
    });

    it("should reject ERC issuance when system is paused", async () => {
      const pausedCertificateId = "ERC_2024_004";
      const [pausedPda] = await anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("erc_certificate"), Buffer.from(pausedCertificateId)],
        program.programId
      );

      // Pause the system
      await program.methods
        .emergencyPause()
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      try {
        await program.methods
          .issueErc(
            pausedCertificateId,
            new anchor.BN(500),
            "Hydro",
            "Validation data"
          )
          .accounts({
            poaConfig: poaConfigPda,
            ercCertificate: pausedPda,
            authority: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();

        throw new Error("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("SystemPaused");
      }

      // Unpause for other tests
      await program.methods
        .emergencyUnpause()
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
    });

    it("should issue multiple ERC certificates from different sources", async () => {
      const sources = [
        { id: "ERC_SOLAR_2024", source: "Solar Farm Beta", energy: 3000 },
        { id: "ERC_WIND_2024", source: "Wind Farm Alpha", energy: 4500 },
        { id: "ERC_HYDRO_2024", source: "Hydro Dam One", energy: 2000 },
      ];

      for (const source of sources) {
        const [sourcePda] = await anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("erc_certificate"), Buffer.from(source.id)],
          program.programId
        );

        const tx = await program.methods
          .issueErc(
            source.id,
            new anchor.BN(source.energy),
            source.source,
            "Validated"
          )
          .accounts({
            poaConfig: poaConfigPda,
            ercCertificate: sourcePda,
            authority: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();

        expect(tx).to.exist;
      }
    });
  });

  describe("ERC Validation for Trading", () => {
    let tradingErcPda: anchor.web3.PublicKey;
    const tradingCertificateId = "ERC_TRADING_2024";

    before(async () => {
      [tradingErcPda] = await anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("erc_certificate"), Buffer.from(tradingCertificateId)],
        program.programId
      );

      // Issue a certificate for trading validation
      await program.methods
        .issueErc(
          tradingCertificateId,
          new anchor.BN(5000),
          "Solar Farm Trading",
          "Ready for trading"
        )
        .accounts({
          poaConfig: poaConfigPda,
          ercCertificate: tradingErcPda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    });

    it("should validate ERC for trading", async () => {
      const tx = await program.methods
        .validateErcForTrading()
        .accounts({
          poaConfig: poaConfigPda,
          ercCertificate: tradingErcPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      // Verify ERC was validated for trading
      const ercCertificate = await program.account.ercCertificate.fetch(tradingErcPda) as any;
      expect(ercCertificate.validatedForTrading).to.be.true;
      expect(ercCertificate.tradingValidatedAt).to.not.be.null;

      // Verify counter was incremented
      const poaConfig = await program.account.poAConfig.fetch(poaConfigPda) as any;
      expect(poaConfig.totalErcsValidated.toNumber()).to.be.greaterThan(0);
    });

    it("should reject double validation", async () => {
      try {
        await program.methods
          .validateErcForTrading()
          .accounts({
            poaConfig: poaConfigPda,
            ercCertificate: tradingErcPda,
            authority: provider.wallet.publicKey,
          })
          .rpc();

        throw new Error("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("AlreadyValidated");
      }
    });

    it("should reject validation of non-existent ERC", async () => {
      // Create a PDA for a certificate that doesn't exist
      const nonExistentCertificateId = "ERC_NONEXISTENT_999";
      const [nonExistentErcPda] = await anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("erc_certificate"), Buffer.from(nonExistentCertificateId)],
        program.programId
      );

      try {
        await program.methods
          .validateErcForTrading()
          .accounts({
            poaConfig: poaConfigPda,
            ercCertificate: nonExistentErcPda,
            authority: provider.wallet.publicKey,
          })
          .rpc();

        throw new Error("Should have thrown an error");
      } catch (error: any) {
        // Should fail because the ERC certificate account doesn't exist
        expect(error.message).to.match(/AccountNotInitialized|Account does not exist|The program expected this account to be already initialized/);
      }
    });
  });

  describe("Governance Configuration", () => {
    it("should update governance configuration", async () => {
      const tx = await program.methods
        .updateGovernanceConfig(false)
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      let poaConfig = await program.account.poAConfig.fetch(poaConfigPda) as any;
      expect(poaConfig.ercValidationEnabled).to.be.false;

      // Re-enable for other tests
      await program.methods
        .updateGovernanceConfig(true)
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      poaConfig = await program.account.poAConfig.fetch(poaConfigPda) as any;
      expect(poaConfig.ercValidationEnabled).to.be.true;
    });

    it("should reject governance configuration update from unauthorized user", async () => {
      const unauthorizedKeypair = anchor.web3.Keypair.generate();

      try {
        await program.methods
          .updateGovernanceConfig(false)
          .accounts({
            poaConfig: poaConfigPda,
            authority: unauthorizedKeypair.publicKey,
          })
          .signers([unauthorizedKeypair])
          .rpc();

        throw new Error("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("UnauthorizedAuthority");
      }
    });
  });

  describe("Maintenance Mode", () => {
    it("should enable maintenance mode", async () => {
      const tx = await program.methods
        .setMaintenanceMode(true)
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      let poaConfig = await program.account.poAConfig.fetch(poaConfigPda) as any;
      expect(poaConfig.maintenanceMode).to.be.true;

      // Disable for other tests
      await program.methods
        .setMaintenanceMode(false)
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      poaConfig = await program.account.poAConfig.fetch(poaConfigPda) as any;
      expect(poaConfig.maintenanceMode).to.be.false;
    });

    it("should reject ERC issuance during maintenance mode", async () => {
      const maintenanceCertificateId = "ERC_MAINTENANCE_2024";
      const [maintenancePda] = await anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("erc_certificate"), Buffer.from(maintenanceCertificateId)],
        program.programId
      );

      // Enable maintenance mode
      await program.methods
        .setMaintenanceMode(true)
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      try {
        await program.methods
          .issueErc(
            maintenanceCertificateId,
            new anchor.BN(1000),
            "Solar",
            "Validation data"
          )
          .accounts({
            poaConfig: poaConfigPda,
            ercCertificate: maintenancePda,
            authority: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();

        throw new Error("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("MaintenanceMode");
      }

      // Disable maintenance mode
      await program.methods
        .setMaintenanceMode(false)
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
    });
  });

  describe("ERC Limits Management", () => {
    it("should update ERC limits", async () => {
      const newMinEnergy = 200;
      const newMaxErc = 2_000_000;
      const newValidityPeriod = 63_072_000; // 2 years

      const tx = await program.methods
        .updateErcLimits(
          new anchor.BN(newMinEnergy),
          new anchor.BN(newMaxErc),
          new anchor.BN(newValidityPeriod)
        )
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      const poaConfig = await program.account.poAConfig.fetch(poaConfigPda) as any;
      expect(poaConfig.minEnergyAmount.toNumber()).to.equal(newMinEnergy);
      expect(poaConfig.maxErcAmount.toNumber()).to.equal(newMaxErc);
      expect(poaConfig.ercValidityPeriod.toNumber()).to.equal(newValidityPeriod);

      // Reset to original values
      await program.methods
        .updateErcLimits(
          new anchor.BN(100),
          new anchor.BN(1_000_000),
          new anchor.BN(31_536_000)
        )
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
    });

    it("should reject invalid ERC limits", async () => {
      try {
        // Min greater than max
        await program.methods
          .updateErcLimits(
            new anchor.BN(500),
            new anchor.BN(200), // Invalid: max < min
            new anchor.BN(31_536_000)
          )
          .accounts({
            poaConfig: poaConfigPda,
            authority: provider.wallet.publicKey,
          })
          .rpc();

        throw new Error("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("InvalidMaximumEnergy");
      }
    });
  });

  describe("Authority Info Management", () => {
    it("should update authority contact info", async () => {
      const newContactInfo = "new_email@utcc.ac.th";

      const tx = await program.methods
        .updateAuthorityInfo(newContactInfo)
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      const poaConfig = await program.account.poAConfig.fetch(poaConfigPda) as any;
      expect(poaConfig.contactInfo).to.equal(newContactInfo);

      // Reset to original
      await program.methods
        .updateAuthorityInfo("engineering_erc@utcc.ac.th")
        .accounts({
          poaConfig: poaConfigPda,
          authority: provider.wallet.publicKey,
        })
        .rpc();
    });
  });

  describe("PoA Configuration State", () => {
    it("should maintain correct PoA configuration state", async () => {
      const poaConfig = await program.account.poAConfig.fetch(poaConfigPda) as any;

      expect(poaConfig.authority).to.not.be.null;
      expect(poaConfig.authorityName).to.equal("University Engineering Department");
      expect(poaConfig.version).to.equal(1);
      expect(poaConfig.createdAt.toNumber()).to.be.greaterThan(0);
      expect(poaConfig.lastUpdated.toNumber()).to.be.greaterThanOrEqual(poaConfig.createdAt.toNumber());
    });

    it("should track ERC statistics correctly", async () => {
      const poaConfig = await program.account.poAConfig.fetch(poaConfigPda) as any;

      expect(poaConfig.totalErcsIssued.toNumber()).to.be.greaterThanOrEqual(0);
      expect(poaConfig.totalErcsValidated.toNumber()).to.be.lessThanOrEqual(poaConfig.totalErcsIssued.toNumber());
    });
  });
});
