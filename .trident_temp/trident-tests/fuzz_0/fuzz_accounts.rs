use trident_fuzz::fuzzing::*;

/// Storage for all account addresses used in fuzz testing.
///
/// This struct serves as a centralized repository for account addresses,
/// enabling their reuse across different instruction flows and test scenarios.
///
/// Docs: https://ackee.xyz/trident/docs/latest/trident-api-macro/trident-types/fuzz-accounts/
#[derive(Default)]
pub struct AccountAddresses {
    pub config: AddressStorage,

    pub authority: AddressStorage,

    pub batch: AddressStorage,

    pub user_token_account: AddressStorage,

    pub vault: AddressStorage,

    pub token_mint: AddressStorage,

    pub token_program: AddressStorage,

    pub market: AddressStorage,

    pub order: AddressStorage,

    pub bridge_config: AddressStorage,

    pub bridge_transfer: AddressStorage,

    pub wrapped_record: AddressStorage,

    pub bridge_escrow: AddressStorage,

    pub user: AddressStorage,

    pub system_program: AddressStorage,

    pub token_config: AddressStorage,

    pub cross_chain_order: AddressStorage,

    pub solana_order: AddressStorage,

    pub pricing_config: AddressStorage,

    pub snapshot: AddressStorage,

    pub erc_certificate: AddressStorage,

    pub payment_info: AddressStorage,

    pub buy_order: AddressStorage,

    pub sell_order: AddressStorage,

    pub buyer_currency_escrow: AddressStorage,

    pub seller_energy_escrow: AddressStorage,

    pub seller_currency_account: AddressStorage,

    pub buyer_energy_account: AddressStorage,

    pub fee_collector: AddressStorage,

    pub wheeling_collector: AddressStorage,

    pub energy_mint: AddressStorage,

    pub currency_mint: AddressStorage,

    pub escrow_authority: AddressStorage,

    pub market_authority: AddressStorage,

    pub secondary_token_program: AddressStorage,

    pub buyer_currency_vault: AddressStorage,

    pub seller_energy_vault: AddressStorage,

    pub seller_currency: AddressStorage,

    pub buyer_energy: AddressStorage,

    pub buyer_authority: AddressStorage,

    pub seller_authority: AddressStorage,

    pub buy_payment_info: AddressStorage,

    pub sell_payment_info: AddressStorage,

    pub stablecoin_mint: AddressStorage,

    pub buyer_stablecoin: AddressStorage,

    pub seller_stablecoin: AddressStorage,

    pub seller_energy: AddressStorage,

    pub energy_token_program: AddressStorage,

    pub pool: AddressStorage,

    pub wormhole_program: AddressStorage,

    pub token_bridge_program: AddressStorage,

    pub marketplace: AddressStorage,

    pub rec_mint: AddressStorage,

    pub carbon_mint: AddressStorage,

    pub treasury: AddressStorage,

    pub confidential_balance: AddressStorage,

    pub mint: AddressStorage,

    pub owner: AddressStorage,

    pub history: AddressStorage,

    pub meter: AddressStorage,

    pub trade_record: AddressStorage,

    pub certificate: AddressStorage,

    pub issuer: AddressStorage,

    pub verified_reading: AddressStorage,

    pub sender_balance: AddressStorage,

    pub receiver_balance: AddressStorage,

    pub receiver_owner: AddressStorage,

    pub user_energy_account: AddressStorage,

    pub user_currency_account: AddressStorage,

    pub pool_energy_vault: AddressStorage,

    pub pool_currency_vault: AddressStorage,

    pub sender: AddressStorage,

    pub receiver: AddressStorage,

    pub sender_rec_account: AddressStorage,

    pub receiver_rec_account: AddressStorage,

    pub mint_authority: AddressStorage,

    pub poa_config: AddressStorage,

    pub new_authority: AddressStorage,

    pub meter_account: AddressStorage,

    pub current_owner: AddressStorage,

    pub new_owner: AddressStorage,
}
