use anchor_lang::prelude::*;
use governance::GovernanceConfig;
use crate::error::TradingError;

pub fn get_governance_config(info: &AccountInfo) -> Result<GovernanceConfig> {
    let data = info.try_borrow_data()?;
    if data.len() < 8 {
        return Err(TradingError::InvalidGovernanceAccount.into());
    }
    let mut ptr = &data[8..];
    GovernanceConfig::deserialize(&mut ptr).map_err(|_| TradingError::InvalidGovernanceAccount.into())
}
