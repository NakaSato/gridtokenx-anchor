//! CPUHeavy Micro-benchmark
//!
//! Measures execution layer performance through compute-intensive operations.
//! Tests the efficiency of the BPF/SBF virtual machine.

use anchor_lang::prelude::*;
use crate::error::BlockbenchError;
use crate::state::*;

/// Simple SHA256-like hash function for benchmarking
/// Uses a simpler approach that doesn't require external hash imports
fn compute_hash(data: &[u8]) -> [u8; 32] {
    let mut result = [0u8; 32];
    
    // Initialize with some non-zero values
    for (i, byte) in result.iter_mut().enumerate() {
        *byte = ((i * 17 + 0x67) % 256) as u8;
    }
    
    // Mix in the data using a simple mixing function
    for (i, &byte) in data.iter().enumerate() {
        let idx = i % 32;
        result[idx] = result[idx]
            .wrapping_add(byte)
            .wrapping_mul(31)
            .rotate_left(3);
        
        // Cross-mixing
        let next_idx = (idx + 1) % 32;
        result[next_idx] ^= result[idx].wrapping_add(byte);
    }
    
    // Final mixing rounds
    for _ in 0..4 {
        for i in 0..32 {
            let prev = result[(i + 31) % 32];
            let next = result[(i + 1) % 32];
            result[i] = result[i]
                .wrapping_add(prev)
                .wrapping_mul(17)
                ^ next;
        }
    }
    
    result
}

/// Maximum array size for sorting (to stay within compute budget)
pub const MAX_SORT_SIZE: u16 = 1024;

/// Maximum loop iterations
pub const MAX_LOOP_ITERATIONS: u32 = 1_000_000;

/// Maximum hash iterations
pub const MAX_HASH_ITERATIONS: u16 = 1000;

/// Maximum matrix dimension
pub const MAX_MATRIX_SIZE: u8 = 16;

/// CPUHeavy: Quicksort benchmark
pub fn cpu_heavy_sort(
    _ctx: Context<CpuHeavy>,
    array_size: u16,
    seed: u64,
) -> Result<u64> {
    require!(array_size <= MAX_SORT_SIZE, BlockbenchError::ArrayTooLarge);
    
    // Generate pseudo-random array using LCG
    let mut arr: Vec<u64> = Vec::with_capacity(array_size as usize);
    let mut rng_state = seed;
    
    for _ in 0..array_size {
        rng_state = rng_state.wrapping_mul(6364136223846793005).wrapping_add(1);
        arr.push(rng_state);
    }
    
    // Perform quicksort
    quicksort(&mut arr, 0, (array_size as i32) - 1);
    
    // Return checksum for verification
    let checksum = arr.iter().fold(0u64, |acc, &x| acc.wrapping_add(x));
    
    msg!("CPUHeavy Sort: size={}, checksum={}", array_size, checksum);
    
    Ok(checksum)
}

/// In-place quicksort implementation
fn quicksort(arr: &mut [u64], low: i32, high: i32) {
    if low < high {
        let pivot = partition(arr, low, high);
        quicksort(arr, low, pivot - 1);
        quicksort(arr, pivot + 1, high);
    }
}

fn partition(arr: &mut [u64], low: i32, high: i32) -> i32 {
    let pivot = arr[high as usize];
    let mut i = low - 1;
    
    for j in low..high {
        if arr[j as usize] <= pivot {
            i += 1;
            arr.swap(i as usize, j as usize);
        }
    }
    
    arr.swap((i + 1) as usize, high as usize);
    i + 1
}

/// CPUHeavy: Tight loop benchmark
pub fn cpu_heavy_loop(
    _ctx: Context<CpuHeavy>,
    iterations: u32,
) -> Result<u64> {
    require!(iterations <= MAX_LOOP_ITERATIONS, BlockbenchError::ArrayTooLarge);
    
    let mut result: u64 = 0;
    
    // Tight loop with mathematical operations
    for i in 0..iterations {
        result = result.wrapping_add(i as u64);
        result = result.wrapping_mul(31);
        result ^= result >> 17;
        result = result.wrapping_add(1);
    }
    
    msg!("CPUHeavy Loop: iterations={}, result={}", iterations, result);
    
    Ok(result)
}

/// CPUHeavy: Hash computation benchmark
pub fn cpu_heavy_hash(
    _ctx: Context<CpuHeavy>,
    iterations: u16,
    data_size: u16,
) -> Result<[u8; 32]> {
    require!(iterations <= MAX_HASH_ITERATIONS, BlockbenchError::TooManyHashIterations);
    require!(data_size <= 1024, BlockbenchError::ValueTooLarge);
    
    // Generate initial data
    let mut data: Vec<u8> = vec![0u8; data_size as usize];
    for (i, byte) in data.iter_mut().enumerate() {
        *byte = (i % 256) as u8;
    }
    
    // Iterative hashing (hash chain)
    let mut current_hash = compute_hash(&data);
    
    for _ in 1..iterations {
        current_hash = compute_hash(&current_hash);
    }
    
    msg!("CPUHeavy Hash: iterations={}, data_size={}", iterations, data_size);
    
    Ok(current_hash)
}

/// CPUHeavy: Matrix multiplication benchmark
pub fn cpu_heavy_matrix(
    _ctx: Context<CpuHeavy>,
    matrix_size: u8,
) -> Result<u64> {
    require!(matrix_size <= MAX_MATRIX_SIZE, BlockbenchError::MatrixTooLarge);
    
    let n = matrix_size as usize;
    
    // Initialize matrices with deterministic values
    let mut a: Vec<u64> = vec![0; n * n];
    let mut b: Vec<u64> = vec![0; n * n];
    let mut c: Vec<u64> = vec![0; n * n];
    
    for i in 0..n {
        for j in 0..n {
            a[i * n + j] = ((i + j + 1) % 100) as u64;
            b[i * n + j] = ((i * j + 1) % 100) as u64;
        }
    }
    
    // Matrix multiplication: C = A * B
    for i in 0..n {
        for j in 0..n {
            let mut sum: u64 = 0;
            for k in 0..n {
                sum = sum.wrapping_add(a[i * n + k].wrapping_mul(b[k * n + j]));
            }
            c[i * n + j] = sum;
        }
    }
    
    // Return checksum
    let checksum: u64 = c.iter().sum();
    
    msg!("CPUHeavy Matrix: size={}x{}, checksum={}", n, n, checksum);
    
    Ok(checksum)
}

#[derive(Accounts)]
pub struct CpuHeavy<'info> {
    /// The payer for the transaction
    pub payer: Signer<'info>,
}
