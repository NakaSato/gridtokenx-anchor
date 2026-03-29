//! GridTokenX Shared Utilities
//!
//! This crate provides shared utilities and types for all GridTokenX Anchor programs.
//!
//! ## Modules
//!
//! - `version`: Program version tracking for upgradeable programs

use anchor_lang::prelude::*;

// Required by #[account] macro — placeholder ID for shared library
declare_id!("GTXShared1111111111111111111111111111111111");

pub mod version;

pub use version::*;
