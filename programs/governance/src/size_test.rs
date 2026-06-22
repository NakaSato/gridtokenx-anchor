use crate::state::GovernanceConfig;

#[test]
fn test_size() {
    // GovernanceConfig is a Borsh `#[account]`: on-chain allocation is `8 + LEN`,
    // where LEN is the serialized (padding-free) size. Assert that invariant.
    // `mem::size_of` (408 here) includes struct alignment padding that Borsh never
    // serializes, so it is NOT the load-bearing number — do not assert on it.
    println!("GovernanceConfig::LEN: {}", GovernanceConfig::LEN);
    assert_eq!(GovernanceConfig::LEN, 405);
}
