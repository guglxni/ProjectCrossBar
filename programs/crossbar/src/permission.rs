//! MagicBlock Permission-program CPI helper (Private Ephemeral Rollups / PER).
//!
//! Honesty contract (`CLAUDE.md`): this encoding is taken from the OFFICIAL
//! `ephemeral-rollups-sdk` ACL module — `vendor/ephemeral-rollups-sdk/rust/
//! pinocchio/src/acl/{consts,types,utils}.rs` and `.../instruction/create_permission.rs`
//! — which is the authoritative client for the LIVE permission program
//! `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1` (verified deployed on devnet AND
//! mainnet). We hand-roll the `Instruction` rather than add the SDK's pinocchio
//! crate as a dependency, so the program keeps its minimal verified dependency tree.
//!
//! NB: an earlier draft used a `CreateGroup` + single-byte-discriminator layout from
//! the `private-payments-demo` starter-kit's generated client. That client targets
//! the kit's LOCAL TEST FIXTURE (`BTWAq…`, `tests/fixtures/permission.so`), NOT the
//! live program, and was rejected on-chain with "invalid instruction data". The live
//! program has NO group concept: it is a single `create_permission` whose
//! discriminator is a u64 (LE) and whose args are `MembersArgs`.
//!
//! See `docs/integrations/PRIVATE_PAYMENTS.md` and `docs/N1_INVESTIGATION.md`.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

/// Canonical MagicBlock Permission program id (PER). Confirmed in the official
/// `ephemeral-rollups-sdk` rust/pinocchio/TS constants and the magicblock skill,
/// and verified live on devnet + mainnet.
pub const PERMISSION_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");

/// Seed of a permission PDA: `["permission:", permissioned_account]`.
pub const PERMISSION_SEED: &[u8] = b"permission:";

/// `CreatePermission` discriminator (u64, little-endian on the wire).
const CREATE_PERMISSION_DISCRIMINATOR: u64 = 0;

// `MemberFlags` bits (acl/types.rs). A member's flags say what ER state it may read.
pub const FLAG_AUTHORITY: u8 = 1 << 0;
pub const FLAG_TX_LOGS: u8 = 1 << 1;
pub const FLAG_TX_BALANCES: u8 = 1 << 2;
pub const FLAG_TX_MESSAGE: u8 = 1 << 3;
pub const FLAG_ACCOUNT_SIGNATURES: u8 = 1 << 4;
/// Full read + manage access (all five flags). Granted to the crank authority so
/// it can both read the confidential book to clear/settle and manage the member list.
pub const FLAGS_ALL: u8 =
    FLAG_AUTHORITY | FLAG_TX_LOGS | FLAG_TX_BALANCES | FLAG_TX_MESSAGE | FLAG_ACCOUNT_SIGNATURES;

/// Derive the permission PDA bound to a delegated account.
pub fn permission_pda(permissioned_account: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PERMISSION_SEED, permissioned_account.as_ref()],
        &PERMISSION_PROGRAM_ID,
    )
}

/// Build the live `CreatePermission` instruction.
///
/// Accounts (from `acl/utils.rs::cpi_create_permission`): `[permissioned_account
/// (readonly signer)], [permission (writable)], [payer (writable signer)],
/// [system_program]`. The permissioned account must SIGN — so this is invoked with
/// `invoke_signed` using that PDA's seeds, BEFORE the account is delegated (while
/// the program still owns it).
///
/// Data: 8-byte u64 discriminator (LE) then `MembersArgs` — option byte `1` (Some →
/// private), u32-LE member count, then `[flags (1) ++ pubkey (32)]` per member.
/// A non-empty member list makes the account private and lists who may read it.
pub fn create_permission_ix(
    permissioned_account: Pubkey,
    permission: Pubkey,
    payer: Pubkey,
    system_program: Pubkey,
    members: &[(u8, Pubkey)],
) -> Instruction {
    let mut data = Vec::with_capacity(8 + 1 + 4 + members.len() * 33);
    data.extend_from_slice(&CREATE_PERMISSION_DISCRIMINATOR.to_le_bytes());
    data.push(1u8); // MembersArgs::Some → private
    data.extend_from_slice(&(members.len() as u32).to_le_bytes());
    for (flags, member) in members {
        data.push(*flags);
        data.extend_from_slice(member.as_ref());
    }
    Instruction {
        program_id: PERMISSION_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(permissioned_account, true),
            AccountMeta::new(permission, false),
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(system_program, false),
        ],
        data,
    }
}
