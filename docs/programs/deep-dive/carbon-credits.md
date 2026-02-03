# Carbon Credit System: Deep Dive

> **Renewable Energy Certificate (REC) Tokenization and Carbon Offset Trading**

---

## 1. Executive Summary

The GridTokenX Carbon Credit System implements a **blockchain-based Renewable Energy Certificate (REC) marketplace** that enables:

- **Tokenization of RECs**: Convert verified renewable energy generation into tradeable digital assets
- **Carbon Offset Tracking**: Measure and record avoided emissions (kg CO2e)
- **Certificate Lifecycle**: Issuance, trading, transfer, and retirement
- **Regulatory Compliance**: Audit trail for sustainability reporting

**Key Innovation:** First integrated REC marketplace on Solana with direct energy trading settlement.

---

## 2. System Architecture

### 2.1 REC Lifecycle

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         REC CERTIFICATE LIFECYCLE                        │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. GENERATION                 2. ISSUANCE                               │
│  ┌─────────────┐              ┌─────────────┐                           │
│  │   Smart     │              │  Carbon     │                           │
│  │   Meter     │──verified───►│ Marketplace │                           │
│  │  Reading    │              │             │                           │
│  └─────────────┘              └──────┬──────┘                           │
│                                      │                                   │
│                                      ▼                                   │
│                           ┌─────────────────┐                           │
│                           │ REC Certificate │                           │
│                           │   (On-Chain)    │                           │
│                           └────────┬────────┘                           │
│                                    │                                     │
│        ┌───────────────────────────┼───────────────────────────┐        │
│        │                           │                           │        │
│        ▼                           ▼                           ▼        │
│  3. TRADING                  4. TRANSFER                 5. RETIREMENT  │
│  ┌─────────────┐           ┌─────────────┐           ┌─────────────┐   │
│  │   Listed    │           │  Ownership  │           │   Retired   │   │
│  │  for Sale   │           │   Changed   │           │ (Permanent) │   │
│  └─────────────┘           └─────────────┘           └─────────────┘   │
│                                                              │          │
│                                                              ▼          │
│                                                    ┌─────────────────┐  │
│                                                    │ Carbon Offset   │  │
│                                                    │ Record (Audit)  │  │
│                                                    └─────────────────┘  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Integration Points

```rust
// Cross-program dependencies
CarbonMarketplace
    ├─► Registry Program (verified meter readings)
    ├─► Energy Token Program (energy amount verification)
    ├─► Trading Program (settlement integration)
    └─► Governance Program (authority validation)
```

---

## 3. State Architecture

### 3.1 CarbonMarketplace Account

```rust
#[account]
#[derive(Default)]
pub struct CarbonMarketplace {
    pub bump: u8,                    // 1 - PDA bump
    pub authority: Pubkey,           // 32 - Marketplace admin
    pub rec_mint: Pubkey,            // 32 - REC token mint
    pub carbon_mint: Pubkey,         // 32 - Carbon credit mint
    pub treasury: Pubkey,            // 32 - Fee collection
    
    // Fee configuration (basis points)
    pub minting_fee_bps: u16,        // 2 - Fee for issuing RECs
    pub trading_fee_bps: u16,        // 2 - Fee for marketplace trades
    pub retirement_fee_bps: u16,     // 2 - Fee for retiring certificates
    
    // Counters
    pub total_minted: u64,           // 8 - Lifetime REC count
    pub total_retired: u64,          // 8 - Retired REC count
    pub total_carbon_offset: u64,    // 8 - Cumulative kg CO2e
    pub active_listings: u32,        // 4 - Current listings
    
    // Configuration
    pub is_active: bool,             // 1 - Marketplace active
    pub kwh_to_rec_rate: u32,        // 4 - Conversion rate (scaled by 1000)
    pub carbon_intensity: u32,       // 4 - g CO2e per kWh
    
    pub _reserved: [u8; 32],         // 32 - Future use
}

impl CarbonMarketplace {
    pub const LEN: usize = 8 + 1 + 32 + 32 + 32 + 32 + 
                           2 + 2 + 2 + 8 + 8 + 8 + 4 + 
                           1 + 4 + 4 + 32; // ~212 bytes
}
```

### 3.2 RecCertificate Account

```rust
#[account]
#[derive(Default)]
pub struct RecCertificate {
    pub bump: u8,                    // 1 - PDA bump
    pub certificate_id: u64,         // 8 - Unique ID
    
    // Ownership
    pub owner: Pubkey,               // 32 - Current owner
    pub issuer: Pubkey,              // 32 - Original issuer
    
    // Certificate data
    pub rec_type: u8,                // 1 - Energy source type
    pub energy_amount: u64,          // 8 - kWh generated
    pub rec_amount: u64,             // 8 - REC tokens issued
    pub carbon_offset: u64,          // 8 - kg CO2e avoided
    
    // Temporal data
    pub generation_start: i64,       // 8 - Generation period start
    pub generation_end: i64,         // 8 - Generation period end
    pub issued_at: i64,              // 8 - Certificate issue time
    
    // Verification
    pub meter: Pubkey,               // 32 - Source meter account
    pub verified_by: Pubkey,         // 32 - Oracle/authority
    
    // Status
    pub is_retired: bool,            // 1 - Retired flag
    pub retired_at: Option<i64>,     // 9 - Retirement timestamp
    pub retirement_reason: u8,       // 1 - Retirement reason enum
    pub retirement_beneficiary: Option<Pubkey>, // 33 - Who claims the offset
    
    pub transfer_count: u8,          // 1 - Ownership transfers
    pub _reserved: [u8; 16],         // 16 - Future use
}

impl RecCertificate {
    pub const LEN: usize = 8 + 1 + 8 + 32 + 32 + 1 + 8 + 8 + 8 +
                           8 + 8 + 8 + 32 + 32 + 1 + 9 + 1 + 33 +
                           1 + 16; // ~296 bytes
}
```

### 3.3 RecListing Account

```rust
#[account]
#[derive(Default)]
pub struct RecListing {
    pub bump: u8,                    // 1 - PDA bump
    pub certificate: Pubkey,         // 32 - Certificate being sold
    pub seller: Pubkey,              // 32 - Listing owner
    pub price: u64,                  // 8 - Price per REC (6 decimals)
    pub listed_at: i64,              // 8 - Listing timestamp
    pub expires_at: Option<i64>,     // 9 - Expiration (optional)
    pub is_active: bool,             // 1 - Listing active
    pub _reserved: [u8; 8],          // 8 - Future use
}

impl RecListing {
    pub const LEN: usize = 8 + 1 + 32 + 32 + 8 + 8 + 9 + 1 + 8; // ~107 bytes
}
```

---

## 4. REC Type Classifications

### 4.1 Energy Source Types

```rust
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum RecType {
    Solar = 0,       // Photovoltaic generation
    Wind = 1,        // Wind turbine generation
    Hydro = 2,       // Hydroelectric power
    Biomass = 3,     // Biomass/biogas
    Geothermal = 4,  // Geothermal energy
    Mixed = 5,       // Mixed renewable sources
}
```

### 4.2 Carbon Intensity by Source

Default carbon intensity values (grams CO2e avoided per kWh):

| Source | Intensity (g/kWh) | Rationale |
|--------|-------------------|-----------|
| Solar | 400 | Displaces coal/gas mix |
| Wind | 450 | Higher displacement factor |
| Hydro | 350 | Base load displacement |
| Biomass | 300 | Partial carbon neutrality |
| Geothermal | 380 | Consistent generation |
| Mixed | 380 | Weighted average |

**Reference:** Thailand grid emission factor: ~500g CO2e/kWh (2024)

---

## 5. Core Instructions

### 5.1 Mint REC Certificate

```rust
pub fn process_mint_rec_certificate(
    ctx: Context<MintRecCertificate>,
    generation_start: i64,
    generation_end: i64,
) -> Result<()> {
    let marketplace = &mut ctx.accounts.marketplace;
    let certificate = &mut ctx.accounts.certificate;
    let verified_reading = &ctx.accounts.verified_reading;
    let clock = Clock::get()?;
    
    // Validate verified reading
    require!(
        verified_reading.verified,
        CarbonError::UnverifiedReading
    );
    require!(
        verified_reading.timestamp >= generation_start &&
        verified_reading.timestamp <= generation_end,
        CarbonError::ReadingOutsidePeriod
    );
    
    // Calculate REC amount and carbon offset
    let energy_amount = verified_reading.value;
    let rec_amount = carbon_utils::calculate_rec_amount(
        energy_amount,
        marketplace.kwh_to_rec_rate,
    );
    let carbon_offset = carbon_utils::calculate_carbon_offset(
        energy_amount,
        marketplace.carbon_intensity,
    );
    
    // Populate certificate
    certificate.bump = ctx.bumps.certificate;
    certificate.certificate_id = marketplace.total_minted;
    certificate.owner = ctx.accounts.issuer.key();
    certificate.issuer = ctx.accounts.issuer.key();
    certificate.rec_type = determine_rec_type(&verified_reading.meter_type);
    certificate.energy_amount = energy_amount;
    certificate.rec_amount = rec_amount;
    certificate.carbon_offset = carbon_offset;
    certificate.generation_start = generation_start;
    certificate.generation_end = generation_end;
    certificate.issued_at = clock.unix_timestamp;
    certificate.meter = verified_reading.meter;
    certificate.verified_by = verified_reading.verified_by;
    certificate.is_retired = false;
    certificate.transfer_count = 0;
    
    // Update marketplace counters
    marketplace.total_minted += 1;
    marketplace.total_carbon_offset += carbon_offset;
    
    // Collect minting fee (if applicable)
    if marketplace.minting_fee_bps > 0 {
        collect_fee(
            ctx.accounts.issuer.to_account_info(),
            ctx.accounts.treasury.to_account_info(),
            calculate_fee(rec_amount, marketplace.minting_fee_bps),
        )?;
    }
    
    emit!(RecMinted {
        certificate_id: certificate.certificate_id,
        issuer: certificate.issuer,
        rec_type: certificate.rec_type,
        energy_amount,
        rec_amount,
        carbon_offset,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}
```

### 5.2 Create Listing

```rust
pub fn process_create_rec_listing(
    ctx: Context<CreateRecListing>,
    price: u64,
    duration_seconds: Option<i64>,
) -> Result<()> {
    let listing = &mut ctx.accounts.listing;
    let certificate = &ctx.accounts.certificate;
    let clock = Clock::get()?;
    
    // Validate ownership
    require!(
        certificate.owner == ctx.accounts.seller.key(),
        CarbonError::NotCertificateOwner
    );
    
    // Validate certificate is not retired
    require!(
        !certificate.is_retired,
        CarbonError::CertificateRetired
    );
    
    // Validate price
    require!(price > 0, CarbonError::InvalidPrice);
    
    listing.bump = ctx.bumps.listing;
    listing.certificate = ctx.accounts.certificate.key();
    listing.seller = ctx.accounts.seller.key();
    listing.price = price;
    listing.listed_at = clock.unix_timestamp;
    listing.expires_at = duration_seconds.map(|d| clock.unix_timestamp + d);
    listing.is_active = true;
    
    // Update marketplace counter
    ctx.accounts.marketplace.active_listings += 1;
    
    emit!(RecListed {
        listing: listing.key(),
        certificate: listing.certificate,
        seller: listing.seller,
        price,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}
```

### 5.3 Purchase REC

```rust
pub fn process_purchase_rec(
    ctx: Context<PurchaseRec>,
) -> Result<()> {
    let listing = &mut ctx.accounts.listing;
    let certificate = &mut ctx.accounts.certificate;
    let marketplace = &mut ctx.accounts.marketplace;
    let clock = Clock::get()?;
    
    // Validate listing is active
    require!(listing.is_active, CarbonError::ListingNotActive);
    
    // Check expiration
    if let Some(expires_at) = listing.expires_at {
        require!(
            clock.unix_timestamp < expires_at,
            CarbonError::ListingExpired
        );
    }
    
    // Calculate total with fee
    let base_amount = listing.price;
    let fee = calculate_fee(base_amount, marketplace.trading_fee_bps);
    let total = base_amount.checked_add(fee).ok_or(CarbonError::Overflow)?;
    
    // Transfer payment to seller
    transfer_tokens(
        ctx.accounts.buyer_payment_account.to_account_info(),
        ctx.accounts.seller_payment_account.to_account_info(),
        ctx.accounts.buyer.to_account_info(),
        base_amount,
    )?;
    
    // Transfer fee to treasury
    if fee > 0 {
        transfer_tokens(
            ctx.accounts.buyer_payment_account.to_account_info(),
            ctx.accounts.treasury.to_account_info(),
            ctx.accounts.buyer.to_account_info(),
            fee,
        )?;
    }
    
    // Transfer certificate ownership
    let old_owner = certificate.owner;
    certificate.owner = ctx.accounts.buyer.key();
    certificate.transfer_count += 1;
    
    // Deactivate listing
    listing.is_active = false;
    marketplace.active_listings = marketplace.active_listings.saturating_sub(1);
    
    emit!(RecPurchased {
        listing: listing.key(),
        certificate: certificate.key(),
        seller: old_owner,
        buyer: ctx.accounts.buyer.key(),
        price: listing.price,
        fee,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}
```

### 5.4 Retire Certificate

```rust
pub fn process_retire_certificate(
    ctx: Context<RetireCertificate>,
    reason: RetirementReason,
    beneficiary_name: Option<String>,
) -> Result<()> {
    let certificate = &mut ctx.accounts.certificate;
    let marketplace = &mut ctx.accounts.marketplace;
    let clock = Clock::get()?;
    
    // Validate ownership
    require!(
        certificate.owner == ctx.accounts.owner.key(),
        CarbonError::NotCertificateOwner
    );
    
    // Validate not already retired
    require!(
        !certificate.is_retired,
        CarbonError::AlreadyRetired
    );
    
    // Mark as retired
    certificate.is_retired = true;
    certificate.retired_at = Some(clock.unix_timestamp);
    certificate.retirement_reason = reason as u8;
    certificate.retirement_beneficiary = Some(ctx.accounts.owner.key());
    
    // Update marketplace counters
    marketplace.total_retired += 1;
    
    // Collect retirement fee (optional)
    if marketplace.retirement_fee_bps > 0 {
        let fee = calculate_fee(certificate.rec_amount, marketplace.retirement_fee_bps);
        // Transfer fee logic...
    }
    
    emit!(RecRetired {
        certificate_id: certificate.certificate_id,
        owner: ctx.accounts.owner.key(),
        reason: reason as u8,
        carbon_offset: certificate.carbon_offset,
        beneficiary_name,
        timestamp: clock.unix_timestamp,
    });
    
    Ok(())
}
```

---

## 6. Carbon Offset Calculations

### 6.1 REC Amount Calculation

```rust
pub mod carbon_utils {
    /// Calculate REC token amount from energy generation
    /// kwh_to_rec_rate is scaled by 1000 (e.g., 1000 = 1 REC per kWh)
    pub fn calculate_rec_amount(energy_kwh: u64, rate: u32) -> u64 {
        (energy_kwh as u128 * rate as u128 / 1000) as u64
    }
    
    /// Calculate carbon offset from energy generation
    /// carbon_intensity is g CO2e per kWh
    /// Returns kg CO2e (divided by 1000)
    pub fn calculate_carbon_offset(energy_kwh: u64, intensity: u32) -> u64 {
        (energy_kwh as u128 * intensity as u128 / 1000) as u64
    }
}
```

### 6.2 Example Calculation

```
Energy Generated: 10,000 kWh (solar)
REC Rate: 1000 (1 REC per 1 kWh)
Carbon Intensity: 400 g/kWh

REC Amount:
  = 10,000 × 1000 / 1000
  = 10,000 RECs

Carbon Offset:
  = 10,000 × 400 / 1000
  = 4,000 kg CO2e
  = 4 tonnes CO2e
```

---

## 7. Retirement Reasons

### 7.1 Reason Enumeration

```rust
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum RetirementReason {
    Voluntary = 0,     // Personal carbon offset
    Compliance = 1,    // Regulatory requirement (RPS/RES)
    Corporate = 2,     // Corporate sustainability goal
    Mandate = 3,       // Government mandate
    Personal = 4,      // Individual offset
}
```

### 7.2 Compliance Integration

```rust
#[event]
pub struct RecRetired {
    pub certificate_id: u64,
    pub owner: Pubkey,
    pub reason: u8,
    pub carbon_offset: u64,
    pub beneficiary_name: Option<String>,
    pub timestamp: i64,
}

// Events can be indexed for compliance reporting
// External systems can subscribe to RecRetired events
// for sustainability dashboards and regulatory filings
```

---

## 8. Fee Structure

### 8.1 Fee Configuration

| Fee Type | Default (bps) | Range | Purpose |
|----------|---------------|-------|---------|
| Minting | 50 (0.5%) | 0-200 | Certificate creation |
| Trading | 100 (1.0%) | 0-300 | Marketplace trades |
| Retirement | 0 | 0-100 | Optional retirement fee |

### 8.2 Fee Calculation

```rust
fn calculate_fee(amount: u64, fee_bps: u16) -> u64 {
    (amount as u128 * fee_bps as u128 / 10_000) as u64
}

fn collect_fee(
    from: AccountInfo,
    to: AccountInfo,
    amount: u64,
) -> Result<()> {
    // Transfer fee using system program or SPL token
    // ...
    Ok(())
}
```

---

## 9. Security Considerations

### 9.1 Double-Minting Prevention

```rust
// Each verified reading can only mint one certificate
// tracked by: ["rec_certificate", meter.key(), generation_start, generation_end]
let (certificate_pda, _) = Pubkey::find_program_address(
    &[
        b"rec_certificate",
        meter.key().as_ref(),
        &generation_start.to_le_bytes(),
        &generation_end.to_le_bytes(),
    ],
    &program_id
);
```

### 9.2 Ownership Validation

```rust
// All transfers require current owner signature
#[derive(Accounts)]
pub struct TransferCertificate<'info> {
    #[account(
        mut,
        constraint = certificate.owner == from.key() @ CarbonError::NotCertificateOwner
    )]
    pub certificate: Account<'info, RecCertificate>,
    pub from: Signer<'info>,
    /// CHECK: Validated as transfer destination
    pub to: AccountInfo<'info>,
}
```

### 9.3 Retirement Finality

```rust
// Retired certificates cannot be transferred or re-retired
#[account(
    mut,
    constraint = !certificate.is_retired @ CarbonError::AlreadyRetired
)]
pub certificate: Account<'info, RecCertificate>,
```

---

## 10. Compute Unit Profile

| Operation | CU Cost | Notes |
|-----------|---------|-------|
| `mint_rec_certificate` | ~25,000 | Verification + state |
| `create_rec_listing` | ~15,000 | Account creation |
| `purchase_rec` | ~35,000 | Two transfers + state |
| `retire_certificate` | ~12,000 | State update + event |
| Carbon calculation | ~1,000 | Integer math |

---

## 11. Integration Example

### 11.1 TypeScript Client

```typescript
import { CarbonMarketplace, RecCertificate } from '@gridtokenx/carbon';

class CarbonClient {
  constructor(
    private program: Program<Trading>,
    private marketplaceAddress: PublicKey,
  ) {}
  
  /**
   * Mint a REC certificate from verified energy generation
   */
  async mintRec(
    meterAccount: PublicKey,
    generationStart: Date,
    generationEnd: Date,
  ): Promise<{ certificateId: bigint; signature: string }> {
    const startTimestamp = Math.floor(generationStart.getTime() / 1000);
    const endTimestamp = Math.floor(generationEnd.getTime() / 1000);
    
    const [certificatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('rec_certificate'),
        meterAccount.toBuffer(),
        new BN(startTimestamp).toArrayLike(Buffer, 'le', 8),
        new BN(endTimestamp).toArrayLike(Buffer, 'le', 8),
      ],
      this.program.programId,
    );
    
    const tx = await this.program.methods
      .mintRecCertificate(new BN(startTimestamp), new BN(endTimestamp))
      .accounts({
        marketplace: this.marketplaceAddress,
        certificate: certificatePda,
        verifiedReading: meterAccount,
        issuer: this.program.provider.publicKey,
        treasury: await this.getTreasury(),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    const certificate = await this.program.account.recCertificate.fetch(
      certificatePda,
    );
    
    return {
      certificateId: certificate.certificateId,
      signature: tx,
    };
  }
  
  /**
   * Retire a certificate for carbon offset claim
   */
  async retireCertificate(
    certificateAddress: PublicKey,
    reason: RetirementReason,
    beneficiaryName?: string,
  ): Promise<string> {
    return this.program.methods
      .retireCertificate(reason, beneficiaryName || null)
      .accounts({
        certificate: certificateAddress,
        marketplace: this.marketplaceAddress,
        owner: this.program.provider.publicKey,
      })
      .rpc();
  }
  
  /**
   * Get total carbon offset for a wallet
   */
  async getTotalCarbonOffset(wallet: PublicKey): Promise<bigint> {
    const certificates = await this.program.account.recCertificate.all([
      {
        memcmp: {
          offset: 8 + 1 + 8, // After discriminator, bump, certificate_id
          bytes: wallet.toBase58(),
        },
      },
    ]);
    
    return certificates
      .filter((c) => c.account.isRetired)
      .reduce((sum, c) => sum + c.account.carbonOffset, BigInt(0));
  }
}
```

---

## 12. Future Enhancements

1. **Verified Carbon Registry Integration**: Connect with Verra/Gold Standard
2. **NFT Certificates**: Visual proof of green energy contribution
3. **Carbon Futures**: Trade forward carbon credits
4. **Scope 3 Tracking**: Supply chain emissions integration
5. **Impact Dashboards**: Real-time visualization of environmental impact

---

## 13. References

1. I-REC Standard. "International REC Standard"
2. Thailand Greenhouse Gas Management Organization (TGO). "Carbon Credit Standards"
3. Verra. "Verified Carbon Standard (VCS)"
4. Gold Standard. "Gold Standard for the Global Goals"
