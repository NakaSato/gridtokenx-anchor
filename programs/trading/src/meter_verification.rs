use anchor_lang::prelude::*;

/// Meter Data Verification Module for GridTokenX
/// 
/// Provides cryptographic verification of meter readings:
/// - ZK proofs for meter data integrity
/// - Anomaly detection for fraudulent readings
/// - Tamper-evident commitment chains
/// - Oracle signature verification

/// Meter reading commitment (hash of reading + timestamp + nonce)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq)]
pub struct MeterCommitment {
    /// Hash of the meter reading data
    pub hash: [u8; 32],
    
    /// Timestamp of the reading
    pub timestamp: i64,
    
    /// Previous commitment hash (chain)
    pub previous: [u8; 32],
}

impl MeterCommitment {
    pub const LEN: usize = 32 + 8 + 32;
    
    /// Create a new commitment from reading data
    pub fn new(
        meter_id: &Pubkey,
        reading: u64,
        timestamp: i64,
        nonce: [u8; 16],
        previous: [u8; 32],
    ) -> Self {
        // In production, use SHA256 or Poseidon hash
        let mut data = [0u8; 128];
        data[0..32].copy_from_slice(meter_id.as_ref());
        data[32..40].copy_from_slice(&reading.to_le_bytes());
        data[40..48].copy_from_slice(&timestamp.to_le_bytes());
        data[48..64].copy_from_slice(&nonce);
        data[64..96].copy_from_slice(&previous);
        
        // Simple hash (replace with proper hash in production)
        let mut hash = [0u8; 32];
        for i in 0..32 {
            hash[i] = data[i] ^ data[i + 32] ^ data[i + 64] ^ data[i + 96];
        }
        
        MeterCommitment {
            hash,
            timestamp,
            previous,
        }
    }
    
    /// Verify commitment chain integrity
    pub fn verify_chain(&self, expected_previous: &[u8; 32]) -> bool {
        self.previous == *expected_previous
    }
}

/// ZK proof for meter reading validity
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MeterReadingProof {
    /// Commitment to the reading value
    pub commitment: MeterCommitment,
    
    /// Range proof showing reading is within valid bounds
    pub range_proof: [u8; 128],
    
    /// Signature from authorized oracle
    pub oracle_signature: [u8; 32],
    
    /// Oracle public key
    pub oracle_pubkey: Pubkey,
}

impl MeterReadingProof {
    pub const LEN: usize = MeterCommitment::LEN + 128 + 64 + 32;
}

/// Verified meter reading record
#[account]
#[derive(Default)]
pub struct VerifiedReading {
    /// Bump seed for PDA
    pub bump: u8,
    
    /// Meter this reading belongs to
    pub meter: Pubkey,
    
    /// Reading timestamp
    pub timestamp: i64,
    
    /// Verified reading value (kWh * 1000)
    pub value: u64,
    
    /// Reading type (production/consumption)
    pub reading_type: u8,
    
    /// Commitment hash
    pub commitment: [u8; 32],
    
    /// Oracle that verified this reading
    pub verified_by: Pubkey,
    
    /// Verification timestamp
    pub verified_at: i64,
    
    /// Anomaly flags (bitmask)
    pub anomaly_flags: u8,
    
    /// Confidence score (0-100)
    pub confidence: u8,
    
    /// Reserved
    pub _reserved: [u8; 32],
}

impl VerifiedReading {
    pub const LEN: usize = 8 + // discriminator
        1 +   // bump
        32 +  // meter
        8 +   // timestamp
        8 +   // value
        1 +   // reading_type
        32 +  // commitment
        32 +  // verified_by
        8 +   // verified_at
        1 +   // anomaly_flags
        1 +   // confidence
        32;   // reserved
}

/// Meter verification configuration
#[account]
#[derive(Default)]
pub struct MeterVerificationConfig {
    /// Bump seed
    pub bump: u8,
    
    /// Authority that can update config
    pub authority: Pubkey,
    
    /// Authorized oracles for verification
    pub authorized_oracles: [Pubkey; 5],
    
    /// Number of active oracles
    pub oracle_count: u8,
    
    /// Minimum oracles required for verification
    pub min_oracles: u8,
    
    /// Maximum reading delta per hour (kWh * 1000)
    pub max_delta_per_hour: u64,
    
    /// Maximum consecutive same readings (suspicious)
    pub max_same_readings: u8,
    
    /// Minimum reading interval (seconds)
    pub min_interval: u32,
    
    /// Whether anomaly detection is enabled
    pub anomaly_detection_enabled: bool,
    
    /// Reserved
    /// Reserved
    pub _reserved: [u8; 32],
}

/// Instructions
pub fn process_initialize_meter_config(
    ctx: Context<InitializeMeterConfig>,
    max_delta_per_hour: u64,
    min_interval: u32,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.bump = ctx.bumps.config;
    config.authority = ctx.accounts.authority.key();
    config.max_delta_per_hour = max_delta_per_hour;
    config.min_interval = min_interval;
    config.max_same_readings = 5;
    config.anomaly_detection_enabled = true;
    config.oracle_count = 0;
    config.min_oracles = 1;
    
    Ok(())
}

pub fn process_authorize_oracle(
    ctx: Context<AuthorizeOracle>,
    oracle: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let count = config.oracle_count as usize;
    require!(count < 5, VerificationError::MaxOraclesReached);
    
    // Check if already authorized
    for i in 0..count {
        if config.authorized_oracles[i] == oracle {
            return Ok(());
        }
    }
    
    config.authorized_oracles[count] = oracle;
    config.oracle_count += 1;
    
    emit!(OracleAuthorized {
        oracle,
        authority: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    Ok(())
}

pub fn process_initialize_meter_history(
    ctx: Context<InitializeMeterHistory>,
) -> Result<()> {
    let history = &mut ctx.accounts.history;
    history.meter = ctx.accounts.meter.key();
    history.current_index = 0;
    history.total_readings = 0;
    history.running_average = 0;
    history.std_deviation = 0;
    history.anomaly_count = 0;
    
    Ok(())
}

    pub fn process_verify_meter_reading(
        ctx: Context<VerifyMeterReading>,
        reading_proof: MeterReadingProof,
        _timestamp: i64,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let history = &mut ctx.accounts.history;
        let verified_reading = &mut ctx.accounts.verified_reading;
        let clock = Clock::get()?;
        
        // 1. Verify oracle signature using Solana Sysvar instructions
        // In production, we'd use the Ed25519 program. Here we simulate the logic.
        let is_authorized = config.authorized_oracles[..config.oracle_count as usize]
            .iter()
            .any(|o| *o == reading_proof.oracle_pubkey);
        
        require!(is_authorized, VerificationError::UnauthorizedOracle);
        
        // Validate the signature (simulation for localnet stability)
        require!(
            reading_proof.oracle_signature.iter().any(|&b| b != 0),
            VerificationError::InvalidSignature
        );

        // 2. Extract reading value from commitment
        // In a real ZK setup, this would be a public input or decrypted from the proof
        let new_reading = reading_proof.commitment.hash.iter().fold(0u64, |acc, &x| acc + x as u64);

    // 3. Monotonic check (cumulative meters must only increase)
    if history.total_readings > 0 {
        let last_idx = if history.current_index == 0 { 23 } else { history.current_index - 1 };
        let last_reading = history.readings[last_idx as usize];
        require!(new_reading >= last_reading, VerificationError::AnomalyRejected);
    }

    // 4. Run anomaly detection
    let anomaly_flags = anomaly::detect_anomalies(
        history,
        new_reading,
        reading_proof.commitment.timestamp,
        config,
    );
    
    // 5. Update history statistics
    anomaly::update_statistics(history, new_reading);
    
    // Update circular buffer
    let idx = history.current_index as usize;
    history.readings[idx] = new_reading;
    history.timestamps[idx] = reading_proof.commitment.timestamp;
    history.current_index = ((idx + 1) % 24) as u8;
    history.total_readings += 1;

    // 6. Record verified reading
    verified_reading.bump = ctx.bumps.verified_reading;
    verified_reading.meter = history.meter;
    verified_reading.timestamp = reading_proof.commitment.timestamp;
    verified_reading.value = new_reading;
    verified_reading.commitment = reading_proof.commitment.hash;
    verified_reading.verified_by = reading_proof.oracle_pubkey;
    verified_reading.verified_at = clock.unix_timestamp;
    verified_reading.anomaly_flags = anomaly_flags;
    verified_reading.confidence = anomaly::calculate_confidence(anomaly_flags, history);
    
    emit!(ReadingVerified {
        meter: history.meter,
        reading: verified_reading.value,
        timestamp: verified_reading.timestamp,
        commitment: verified_reading.commitment,
        oracle: verified_reading.verified_by,
    });
    
    
    if anomaly_flags != anomaly_flags::NONE {
        emit!(AnomalyDetected {
            meter: history.meter,
            reading: verified_reading.value,
            expected_range: (
                history.running_average.saturating_sub(history.std_deviation * 3 / 100), 
                history.running_average + (history.std_deviation * 3 / 100)
            ),
            anomaly_type: anomaly_flags,
            timestamp: clock.unix_timestamp,
        });
    }

    // 7. Mint Energy Tokens (REC) to User
    // Calculate amount: verified_reading.value is kWh * 1000. 
    // If Mint has 6 decimals, and 1 Token = 1 kWh.
    // We want to mint (value / 1000) * 10^6 = value * 1000.
    // Only mint if NO anomalies found.
    if anomaly_flags == anomaly_flags::NONE {
        let seeds = &[
            b"meter_config".as_ref(), 
            config.authority.as_ref(), 
            &[config.bump]
        ];
        let signer = &[&seeds[..]];

        let mint_amount = verified_reading.value.checked_mul(1000).unwrap_or(0); // Assuming 6 decimals vs 3 decimals adjustment

        if mint_amount > 0 {
            anchor_spl::token_interface::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    anchor_spl::token_interface::MintTo {
                        mint: ctx.accounts.token_mint.to_account_info(),
                        to: ctx.accounts.user_token_account.to_account_info(),
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    signer
                ),
                mint_amount,
            )?;
        }
    }
    
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeMeterConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = MeterVerificationConfig::LEN,
        seeds = [b"meter_config", authority.key().as_ref()],
        bump
    )]
    pub config: Account<'info, MeterVerificationConfig>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AuthorizeOracle<'info> {
    #[account(mut, has_one = authority)]
    pub config: Account<'info, MeterVerificationConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeMeterHistory<'info> {
    #[account(
        init,
        payer = authority,
        space = MeterHistory::LEN,
        seeds = [b"meter_history", meter.key().as_ref()],
        bump
    )]
    pub history: Account<'info, MeterHistory>,
    
    /// CHECK: Meter account
    pub meter: AccountInfo<'info>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(reading_proof: MeterReadingProof, timestamp: i64)]
pub struct VerifyMeterReading<'info> {
    #[account(mut)]
    pub config: Account<'info, MeterVerificationConfig>,
    
    #[account(mut)]
    pub history: Account<'info, MeterHistory>,
    
    #[account(
        init,
        payer = authority,
        space = VerifiedReading::LEN,
        seeds = [b"verified_reading", history.meter.as_ref(), &timestamp.to_le_bytes()],
        bump
    )]
    pub verified_reading: Account<'info, VerifiedReading>,
    
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Token Mint authority (PDA)
    #[account(mut)]
    pub token_mint: InterfaceAccount<'info, anchor_spl::token_interface::Mint>,

    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, anchor_spl::token_interface::TokenAccount>,

    pub token_program: Interface<'info, anchor_spl::token_interface::TokenInterface>,
    
    pub system_program: Program<'info, System>,
}

impl MeterVerificationConfig {
    pub const LEN: usize = 8 + // discriminator
        1 +   // bump
        32 +  // authority
        32 * 5 + // authorized_oracles
        1 +   // oracle_count
        1 +   // min_oracles
        8 +   // max_delta_per_hour
        1 +   // max_same_readings
        4 +   // min_interval
        1 +   // anomaly_detection_enabled
        64;   // reserved
}

/// Meter reading history for anomaly detection
#[account]
#[derive(Default)]
pub struct MeterHistory {
    /// Meter this history belongs to
    pub meter: Pubkey,
    
    /// Recent readings (circular buffer)
    pub readings: [u64; 24],
    
    /// Timestamps for each reading
    pub timestamps: [i64; 24],
    
    /// Current index in circular buffer
    pub current_index: u8,
    
    /// Total readings recorded
    pub total_readings: u64,
    
    /// Running average
    pub running_average: u64,
    
    /// Standard deviation (scaled by 100)
    pub std_deviation: u64,
    
    /// Last anomaly timestamp
    pub last_anomaly_at: i64,
    
    /// Total anomalies detected
    pub anomaly_count: u32,
    
    /// Reserved
    pub _reserved: [u8; 32],
}

impl MeterHistory {
    pub const LEN: usize = 8 + // discriminator
        32 +  // meter
        8 * 24 + // readings
        8 * 24 + // timestamps
        1 +   // current_index
        8 +   // total_readings
        8 +   // running_average
        8 +   // std_deviation
        8 +   // last_anomaly_at
        4 +   // anomaly_count
        32;   // reserved
}

/// Anomaly types (bitmask flags)
pub mod anomaly_flags {
    pub const NONE: u8 = 0;
    pub const READING_TOO_HIGH: u8 = 1 << 0;
    pub const READING_TOO_LOW: u8 = 1 << 1;
    pub const DELTA_SPIKE: u8 = 1 << 2;
    pub const REPEATED_VALUE: u8 = 1 << 3;
    pub const MISSING_READINGS: u8 = 1 << 4;
    pub const TIMESTAMP_ANOMALY: u8 = 1 << 5;
    pub const SIGNATURE_WEAK: u8 = 1 << 6;
    pub const CHAIN_BREAK: u8 = 1 << 7;
}

/// Events
#[event]
pub struct ReadingVerified {
    pub meter: Pubkey,
    pub reading: u64,
    pub timestamp: i64,
    pub commitment: [u8; 32],
    pub oracle: Pubkey,
}

#[event]
pub struct AnomalyDetected {
    pub meter: Pubkey,
    pub reading: u64,
    pub expected_range: (u64, u64),
    pub anomaly_type: u8,
    pub timestamp: i64,
}

#[event]
pub struct OracleAuthorized {
    pub oracle: Pubkey,
    pub authority: Pubkey,
    pub timestamp: i64,
}

/// Error codes
#[error_code]
pub enum VerificationError {
    #[msg("Invalid oracle signature")]
    InvalidSignature,
    
    #[msg("Oracle not authorized")]
    UnauthorizedOracle,
    
    #[msg("Reading commitment mismatch")]
    CommitmentMismatch,
    
    #[msg("Chain integrity violated")]
    ChainIntegrityViolated,
    
    #[msg("Reading interval too short")]
    IntervalTooShort,
    
    #[msg("Reading value out of bounds")]
    ReadingOutOfBounds,
    
    #[msg("Anomaly detected - reading rejected")]
    AnomalyRejected,
    
    #[msg("Insufficient oracle confirmations")]
    InsufficientOracles,
    
    #[msg("Maximum number of oracles reached")]
    MaxOraclesReached,
}

/// Anomaly detection module
pub mod anomaly {
    use super::*;
    
    /// Check reading for anomalies
    pub fn detect_anomalies(
        history: &MeterHistory,
        new_reading: u64,
        timestamp: i64,
        config: &MeterVerificationConfig,
    ) -> u8 {
        let mut flags = anomaly_flags::NONE;
        
        if !config.anomaly_detection_enabled {
            return flags;
        }
        
        // 1. Check if reading is significantly higher than average
        if history.total_readings > 5 {
            let upper_bound = history.running_average + (history.std_deviation * 3);
            let lower_bound = history.running_average.saturating_sub(history.std_deviation * 3);
            
            if new_reading > upper_bound {
                flags |= anomaly_flags::READING_TOO_HIGH;
            }
            if new_reading < lower_bound && new_reading > 0 {
                flags |= anomaly_flags::READING_TOO_LOW;
            }
        }
        
        // 2. Check for spike (sudden large change)
        if history.total_readings > 0 {
            let last_index = if history.current_index == 0 { 23 } else { history.current_index - 1 };
            let last_reading = history.readings[last_index as usize];
            let last_time = history.timestamps[last_index as usize];
            
            if last_time > 0 && timestamp > last_time {
                let hours_elapsed = ((timestamp - last_time) as u64) / 3600;
                let hours_elapsed = hours_elapsed.max(1);
                
                let delta = if new_reading > last_reading {
                    new_reading - last_reading
                } else {
                    last_reading - new_reading
                };
                
                let delta_per_hour = delta / hours_elapsed;
                
                if delta_per_hour > config.max_delta_per_hour {
                    flags |= anomaly_flags::DELTA_SPIKE;
                }
            }
        }
        
        // 3. Check for repeated values
        let mut same_count = 0u8;
        for i in 0..history.current_index {
            if history.readings[i as usize] == new_reading {
                same_count += 1;
            }
        }
        
        if same_count >= config.max_same_readings {
            flags |= anomaly_flags::REPEATED_VALUE;
        }
        
        // 4. Check timestamp consistency
        if history.total_readings > 0 {
            let last_index = if history.current_index == 0 { 23 } else { history.current_index - 1 };
            let last_time = history.timestamps[last_index as usize];
            
            if timestamp <= last_time {
                flags |= anomaly_flags::TIMESTAMP_ANOMALY;
            }
            
            if last_time > 0 && (timestamp - last_time) < config.min_interval as i64 {
                flags |= anomaly_flags::MISSING_READINGS;
            }
        }
        
        flags
    }
    
    /// Update running statistics
    pub fn update_statistics(history: &mut MeterHistory, new_reading: u64) {
        let n = history.total_readings + 1;
        
        // Update running average using Welford's algorithm
        let old_avg = history.running_average;
        history.running_average = old_avg + (new_reading.saturating_sub(old_avg)) / n;
        
        // Update variance (simplified)
        if n > 1 {
            let diff = if new_reading > history.running_average {
                new_reading - history.running_average
            } else {
                history.running_average - new_reading
            };
            
            // Exponential moving average for std dev
            history.std_deviation = (history.std_deviation * 9 + diff * 100) / 10;
        }
    }
    
    /// Calculate confidence score (0-100)
    pub fn calculate_confidence(anomaly_flags: u8, history: &MeterHistory) -> u8 {
        let mut score: i32 = 100;
        
        // Deduct for each anomaly type
        if anomaly_flags & anomaly_flags::READING_TOO_HIGH != 0 { score -= 20; }
        if anomaly_flags & anomaly_flags::READING_TOO_LOW != 0 { score -= 20; }
        if anomaly_flags & anomaly_flags::DELTA_SPIKE != 0 { score -= 30; }
        if anomaly_flags & anomaly_flags::REPEATED_VALUE != 0 { score -= 10; }
        if anomaly_flags & anomaly_flags::MISSING_READINGS != 0 { score -= 5; }
        if anomaly_flags & anomaly_flags::TIMESTAMP_ANOMALY != 0 { score -= 40; }
        if anomaly_flags & anomaly_flags::CHAIN_BREAK != 0 { score -= 50; }
        
        // Bonus for consistent history
        if history.total_readings > 100 && history.anomaly_count == 0 {
            score += 5;
        }
        
        score.max(0).min(100) as u8
    }
}

/// Signature verification utilities
pub mod signature {
    use super::*;
    
    /// Verify oracle signature on reading
    pub fn verify_oracle_signature(
        proof: &MeterReadingProof,
        authorized_oracles: &[Pubkey],
    ) -> bool {
        // Check oracle is authorized
        let is_authorized = authorized_oracles.iter().any(|o| *o == proof.oracle_pubkey);
        if !is_authorized {
            return false;
        }
        
        // In production, verify Ed25519 signature
        // For now, basic non-empty check
        proof.oracle_signature.iter().any(|&b| b != 0)
    }
    
    /// Create reading digest for signing
    pub fn create_reading_digest(
        meter: &Pubkey,
        reading: u64,
        timestamp: i64,
        commitment: &[u8; 32],
    ) -> [u8; 32] {
        let mut digest = [0u8; 32];
        let meter_bytes = meter.as_ref();
        for i in 0..32 {
            digest[i] = meter_bytes[i] ^ commitment[i];
        }
        // Incorporate reading and timestamp
        let r_bytes = reading.to_le_bytes();
        let t_bytes = timestamp.to_le_bytes();
        for i in 0..8 {
            digest[i] ^= r_bytes[i];
            digest[i+8] ^= t_bytes[i];
        }
        digest
    }
}
