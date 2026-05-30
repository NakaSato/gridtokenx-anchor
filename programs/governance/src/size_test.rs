use crate::state::PoAConfig;

#[test]
fn test_size() {
    println!("PoAConfig size: {}", std::mem::size_of::<PoAConfig>());
    assert_eq!(std::mem::size_of::<PoAConfig>(), 405);
}
