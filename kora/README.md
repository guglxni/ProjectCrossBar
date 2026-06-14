# Kora gasless layer for Project CrossBar

[Kora](https://github.com/solana-foundation/kora) is the Solana Foundation's
relayer/paymaster. Here it sponsors the SOL fee for CrossBar order transactions,
so a taker or maker can `submit_order` (and `cancel_order`) without holding any
SOL. That reinforces the project's thesis: the unit of competition is price, not
who can afford priority fees. It also makes agent/aggregator routing (prd.md
section 2) trivial, since the router need not fund every end user with gas.

Why it composes cleanly with CrossBar: `submit_order` does **no token CPI inside
the ER** (escrow is an internal claimable/reserved ledger on `OpenOrders`; real
SPL moves happen only at the L1 boundary in `deposit`/`withdraw`). So a relayed
`submit_order` is a cheap, bounded transaction that is safe to sponsor.

## Files

- `kora.toml`     - relayer policy: which programs/tokens are allowed, fee model.
- `signers.toml`  - the fee-payer signer pool (one in-memory signer).
- `fee-payer.json`- the sponsoring keypair (gitignored). Needs devnet SOL.
- `.env`          - `SIGNER_1_PRIVATE_KEY` -> path of `fee-payer.json` (gitignored).

`kora.toml` allows exactly the programs a CrossBar transaction touches
(CrossBar, System, Compute Budget, SPL Token, MagicBlock delegation) and
registers the market quote mint. Fee model is `free` (fully sponsored) for the
devnet demo; switch `[validation.price]` to `margin`/`fixed` to charge fees in
the quote token (USDC) for production.

## Validate the config (no RPC, fast)

```bash
set -a; source kora/.env; set +a
kora --config kora/kora.toml config validate --signers-config kora/signers.toml
# => Configuration validation successful
```

## Run the relayer (devnet)

```bash
# 1. fund the fee payer on devnet
solana airdrop 2 $(solana-keygen pubkey kora/fee-payer.json) --url devnet

# 2. start the Kora RPC relayer
set -a; source kora/.env; set +a
kora --rpc-url https://api.devnet.solana.com \
     --config kora/kora.toml \
     rpc start --signers-config kora/signers.toml
```

## Gasless submit flow (client side)

With the relayer running, a client builds a CrossBar `submit_order` instruction
with the Kora fee payer as the transaction fee payer, then calls the Kora RPC to
sign and send it (the methods are `estimateTransactionFee`, `signTransaction`,
and `signAndSendTransaction` on the Kora JSON-RPC):

1. Build the `submit_order` ix (trader signs as `owner`).
2. Set the transaction fee payer to the Kora signer pubkey.
3. POST the serialized tx to the Kora RPC `signAndSendTransaction`.
4. Kora validates it against `kora.toml` (allowed programs/accounts/limits),
   co-signs as fee payer, and submits. The trader spends no SOL.

A typescript client that does this lands with the devnet deploy + IDL (it needs
the on-chain program live).
