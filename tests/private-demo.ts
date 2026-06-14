/**
 * Project CrossBar — Private Ephemeral Rollup (PER) demo (standalone, `npx tsx`).
 *
 * Exercises the on-chain PER wiring: create a MagicBlock permission `group` over
 * the market and bind `permission` accounts to the confidential clearing state
 * (BatchBook = resting order sizes, BatchResult = per-order fills) and to a
 * trader's OpenOrders. Once these accounts are later delegated to a TEE validator
 * and read via the TEE RPC, only group members can decrypt the resting book — so
 * a large resting order no longer leaks a size signal across windows. Batching
 * hides order/timing (N1); PER hides amounts. See docs/integrations/PRIVATE_PAYMENTS.md
 * and docs/N1_INVESTIGATION.md.
 *
 * The canonical MagicBlock permission program ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1
 * is deployed on devnet AND mainnet (verified), so make_private executes against a
 * REAL program. To run it locally and for free, clone that program into a test
 * validator (see scripts/run-private-demo-local.sh).
 *
 *   ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
 *   ANCHOR_WALLET=$HOME/.config/solana/id.json \
 *   npx tsx tests/private-demo.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import * as fs from "fs";

// Canonical MagicBlock Permission program (PER). Confirmed in ephemeral-rollups-sdk
// constants + .agents/skills/magicblock/resources.md; live on devnet + mainnet.
const PERMISSION_PROGRAM = new PublicKey("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
const enc = (s: string) => Buffer.from(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const THROTTLE_MS = Number(process.env.THROTTLE_MS || 0);

// permission PDA: ["permission:", permissioned_account]
const permissionPda = (acct: PublicKey) =>
  PublicKey.findProgramAddressSync([enc("permission:"), acct.toBuffer()], PERMISSION_PROGRAM)[0];

async function main() {
  const idl = JSON.parse(fs.readFileSync(__dirname + "/../target/idl/crossbar.json", "utf8"));
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program(idl as anchor.Idl, provider);
  const conn = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;

  console.log("CrossBar PER demo — cluster:", (conn as any)._rpcEndpoint);

  // Fail fast and clearly if the permission program is not on this cluster.
  const permInfo = await conn.getAccountInfo(PERMISSION_PROGRAM);
  if (!permInfo) {
    console.error(
      `\nPermission program ${PERMISSION_PROGRAM.toBase58()} is NOT present on this cluster.\n` +
        `It is live on devnet/mainnet; for a local validator, clone it first:\n` +
        `  ./scripts/run-private-demo-local.sh\n`,
    );
    process.exit(2);
  }
  console.log("✓ permission program present (executable:", permInfo.executable, ")");

  // --- market setup (fresh mints → fresh market/group, re-runnable) ---
  const baseMint = await createMint(conn, wallet.payer, wallet.publicKey, null, 6);
  const quoteMint = await createMint(conn, wallet.payer, wallet.publicKey, null, 6);
  const market = PublicKey.findProgramAddressSync(
    [enc("market"), baseMint.toBuffer(), quoteMint.toBuffer()], program.programId)[0];
  const seed = (s: string) => PublicKey.findProgramAddressSync([enc(s), market.toBuffer()], program.programId)[0];
  const book = seed("book"), result = seed("result"), oracle = seed("oracle");
  const baseVault = seed("base_vault"), quoteVault = seed("quote_vault");
  const oo = (owner: PublicKey) =>
    PublicKey.findProgramAddressSync([enc("open_orders"), market.toBuffer(), owner.toBuffer()], program.programId)[0];

  await program.methods.initMarket({
    tickIntervalMs: 50, commitEveryTicks: 20, bandDeltaBps: 0, feeBps: 0,
    maxOrdersPerBatch: 64, oracleMaxAgeSlots: 0, forceUndelegateTimeoutSlots: 100,
    windowMinTicks: 0, windowMaxTicks: 0, cfmmBase: new BN(0), cfmmQuote: new BN(0),
    cfmmBandBps: 0, cfmmLevels: 0, lazerFeedId: new BN(0), crankAuthority: wallet.publicKey,
  } as any).accountsPartial({
    payer: wallet.publicKey, baseMint, quoteMint, market, book, result, oracle,
    baseVault, quoteVault, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).rpc();
  console.log("✓ market initialized:", market.toBase58());

  // --- PER: make the clearing state private ---
  const bookPermission = permissionPda(book);
  const resultPermission = permissionPda(result);
  await sleep(THROTTLE_MS);
  await program.methods.makePrivate().accountsPartial({
    payer: wallet.publicKey, market, book, result,
    bookPermission, resultPermission,
    permissionProgram: PERMISSION_PROGRAM, systemProgram: SystemProgram.programId,
  }).rpc();
  console.log("✓ make_private: book/result permissions created");

  // verify the permission program now owns the new accounts
  for (const [name, pk] of [["book permission", bookPermission], ["result permission", resultPermission]] as const) {
    const info = await conn.getAccountInfo(pk);
    const ok = info && info.owner.equals(PERMISSION_PROGRAM);
    console.log(`    ${ok ? "✓" : "✗"} ${name} ${pk.toBase58()} owned by permission program: ${ok}`);
    if (!ok) throw new Error(`${name} not created/owned by permission program`);
  }

  // --- PER: make one trader's OpenOrders private (reuses the market group) ---
  // OpenOrders is created on first deposit; do a tiny deposit for the wallet.
  const baseAta = await getOrCreateAssociatedTokenAccount(conn, wallet.payer, baseMint, wallet.publicKey);
  await mintTo(conn, wallet.payer, baseMint, baseAta.address, wallet.publicKey, 1_000_000);
  await sleep(THROTTLE_MS);
  await program.methods.deposit(new BN(1_000_000), true).accountsPartial({
    owner: wallet.publicKey, market, openOrders: oo(wallet.publicKey),
    vault: baseVault, userTokenAccount: baseAta.address,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).rpc();
  const ooPk = oo(wallet.publicKey);
  const ooPermission = permissionPda(ooPk);
  await sleep(THROTTLE_MS);
  await program.methods.makeOpenOrdersPrivate(wallet.publicKey).accountsPartial({
    payer: wallet.publicKey, market, openOrders: ooPk,
    openOrdersPermission: ooPermission,
    permissionProgram: PERMISSION_PROGRAM, systemProgram: SystemProgram.programId,
  }).rpc();
  const ooInfo = await conn.getAccountInfo(ooPermission);
  const ooOk = ooInfo && ooInfo.owner.equals(PERMISSION_PROGRAM);
  console.log(`✓ make_open_orders_private: ${ooOk ? "✓" : "✗"} permission ${ooPermission.toBase58()}`);
  if (!ooOk) throw new Error("OpenOrders permission not created");

  console.log("\nPER DEMO OK — clearing state + trader ledger are permissioned.");
  console.log("Next (live privacy): delegate this set to a TEE validator and read via the");
  console.log("TEE RPC (https://devnet-tee.magicblock.app?token=...); only the group member");
  console.log("(crank authority) can then decrypt the resting book. N1 unaffected.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
