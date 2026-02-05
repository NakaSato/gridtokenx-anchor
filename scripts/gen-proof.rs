use solana_zk_token_sdk::{
    instruction::{
        range_proof::{RangeProofU64Data},
    },
};
use bytemuck::bytes_of;
use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();
    let mode = &args[1];
    let amount: u64 = args[2].parse().expect("Invalid amount");

    if mode == "range" {
        let (commitment, opening) = solana_zk_token_sdk::encryption::pedersen::Pedersen::new(amount);
        let range_proof_data = RangeProofU64Data::new(&commitment, amount, &opening).expect("Failed to generate range proof");
        
        println!("--- RANGE PROOF START ---");
        println!("COMMITMENT: {}", hex::encode(bytes_of(&range_proof_data.context.commitment)));
        println!("PROOF: {}", hex::encode(bytes_of(&range_proof_data.proof)));
        println!("--- RANGE PROOF END ---");
    } else if mode == "transfer" {
        use solana_zk_token_sdk::encryption::elgamal::ElGamalKeypair;
        use solana_zk_token_sdk::instruction::transfer::TransferData;

        let sender_kp = ElGamalKeypair::new_rand();
        let receiver_kp = ElGamalKeypair::new_rand();
        let sender_balance: u64 = 1000;
        
        let (_old_commitment, old_opening) = solana_zk_token_sdk::encryption::pedersen::Pedersen::new(sender_balance);
        let old_ciphertext = sender_kp.pubkey().encrypt_with(sender_balance, &old_opening);

        let transfer_data = TransferData::new(
            amount,
            (sender_balance, &old_ciphertext),
            &sender_kp,
            (&receiver_kp.pubkey(), &receiver_kp.pubkey()), // Auditor = Receiver for simple test
        ).expect("Failed to generate transfer proof");

        println!("--- TRANSFER PROOF START ---");
        println!("PROOF: {}", hex::encode(bytes_of(&transfer_data)));
        println!("--- TRANSFER PROOF END ---");
    }
}
