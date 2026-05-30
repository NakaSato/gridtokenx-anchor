use anchor_lang::prelude::*;
use governance::PoAConfig;
use crate::error::TradingError;

pub fn get_governance_config(info: &AccountInfo) -> Result<PoAConfig> {
    let data = info.try_borrow_data()?;
    if data.len() < 8 {
        return Err(TradingError::InvalidGovernanceAccount.into());
    }
    let mut ptr = &data[8..];
    PoAConfig::deserialize(&mut ptr).map_err(|_| TradingError::InvalidGovernanceAccount.into())
}
