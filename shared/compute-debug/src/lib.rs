//! # Compute Debug Macro
//!
//! Provides the `compute_fn!` macro for debugging compute unit consumption
//! in Anchor programs. This macro only logs on localnet when the feature is enabled.
//!
//! ## Usage
//!
//! ```rust,ignore
//! use compute_debug::compute_fn;
//!
//! pub fn my_instruction(ctx: Context<MyContext>) -> Result<()> {
//!     compute_fn!("my_instruction" => {
//!         // Your instruction logic here
//!         msg!("Doing some work...");
//!     });
//!     Ok(())
//! }
//! ```
//!
//! ## Output (localnet only)
//!
//! ```text
//! Program log: >>> my_instruction: start
//! Program consumption: XXXXX units remaining
//! Program log: Doing some work...
//! Program consumption: YYYYY units remaining
//! Program log: <<< my_instruction: end
//! ```

/// Log the remaining compute units using the syscall directly.
/// This is only active when the `localnet` feature is enabled.
#[cfg(feature = "localnet")]
#[inline(always)]
pub fn log_compute_units_syscall() {
    #[cfg(target_os = "solana")]
    unsafe {
        extern "C" {
            fn sol_log_compute_units_();
        }
        sol_log_compute_units_();
    }
}

#[cfg(not(feature = "localnet"))]
#[inline(always)]
pub fn log_compute_units_syscall() {
    // No-op when not on localnet
}

/// A macro for measuring compute units consumed by a block of code.
///
/// This macro logs the compute units at the start and end of the block,
/// allowing you to see exactly how many CUs are consumed.
///
/// # Arguments
///
/// * `$name` - A string label for the operation being measured
/// * `$block` - The code block to measure
///
/// # Example
///
/// ```rust,ignore
/// compute_fn!("transfer_tokens" => {
///     token::transfer(cpi_ctx, amount)?;
/// });
/// ```
///
/// # Output (localnet only)
///
/// ```text
/// Program log: >>> transfer_tokens: start
/// Program consumption: XXXXX units remaining
/// ...
/// Program consumption: YYYYY units remaining  
/// Program log: <<< transfer_tokens: end
/// ```
#[macro_export]
macro_rules! compute_fn {
    ($name:expr => $block:block) => {{
        #[cfg(feature = "localnet")]
        {
            anchor_lang::prelude::msg!(concat!(">>> ", $name, ": start"));
            $crate::log_compute_units_syscall();
        }

        let result = $block;

        #[cfg(feature = "localnet")]
        {
            $crate::log_compute_units_syscall();
            anchor_lang::prelude::msg!(concat!("<<< ", $name, ": end"));
        }

        result
    }};
}

/// A macro for measuring compute units with a dynamic message.
///
/// Similar to `compute_fn!` but allows for runtime-generated labels.
///
/// # Example
///
/// ```rust,ignore
/// let amount = 1000u64;
/// compute_fn_with_msg!(&format!("transfer_{}", amount) => {
///     token::transfer(cpi_ctx, amount)?;
/// });
/// ```
#[macro_export]
macro_rules! compute_fn_with_msg {
    ($name:expr => $block:block) => {{
        #[cfg(feature = "localnet")]
        {
            anchor_lang::prelude::msg!(">>> {}: start", $name);
            $crate::log_compute_units_syscall();
        }

        let result = $block;

        #[cfg(feature = "localnet")]
        {
            $crate::log_compute_units_syscall();
            anchor_lang::prelude::msg!("<<< {}: end", $name);
        }

        result
    }};
}

/// Log a checkpoint with compute units.
/// Use this to mark specific points in your code for CU measurement.
///
/// # Example
///
/// ```rust,ignore
/// // Before expensive operation
/// compute_checkpoint!("before_transfer");
/// token::transfer(cpi_ctx, amount)?;
/// compute_checkpoint!("after_transfer");
/// ```
#[macro_export]
macro_rules! compute_checkpoint {
    ($name:expr) => {{
        #[cfg(feature = "localnet")]
        {
            anchor_lang::prelude::msg!(concat!("=== CHECKPOINT: ", $name, " ==="));
            $crate::log_compute_units_syscall();
        }
    }};
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_compute_fn_compiles() {
        let result = compute_fn!("test_block" => {
            1 + 1
        });
        assert_eq!(result, 2);
    }

    #[test]
    fn test_compute_fn_with_msg_compiles() {
        let label = "dynamic_test";
        let result = compute_fn_with_msg!(label => {
            2 + 2
        });
        assert_eq!(result, 4);
    }
}
