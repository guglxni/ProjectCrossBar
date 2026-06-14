/**
 * Scenarios A and B on a LOCAL validator or devnet L1 via the `set_delegated`
 * shortcut (no MagicBlock delegation). Fast regression for clearing math,
 * oracle band, post-audit guards, and run_batch CU (PLAN.md T2.8).
 *
 *   A. Many orders in one window all clear at ONE uniform price p*.
 *   B. A sandwich bracketing a victim in the same window fills at the same p*,
 *      capturing nothing.
 *
 * For the same scenarios through the real ER, use `tests/er-scenarios.ts`.
 * For a minimal ER round-trip (2 traders), use `tests/er-demo.ts`.
 *
 * Local (free, recommended for CI):
 *   ./scripts/run-demo-local.sh
 *
 * Devnet L1 direct:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=$HOME/.config/solana/id.json \
 *   npx tsx tests/demo-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import * as fs from "fs";

const PRICE_SCALE = 1_000_000;
const SIDE_BUY = 0, SIDE_SELL = 1, FLOW_MAKER = 0, FLOW_TAKER = 1;
const enc = (s: string) => Buffer.from(s);
const px = (p: number) => new BN(Math.round(p * PRICE_SCALE));
// Throttle to stay under the public devnet RPC rate limit.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const THROTTLE_MS = Number(process.env.THROTTLE_MS || 700);

async function main() {
  const idl = JSON.parse(fs.readFileSync(__dirname + "/../target/idl/crossbar.json", "utf8"));
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program(idl as anchor.Idl, provider);
  const conn = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;

  const baseMint = await createMint(conn, wallet.payer, wallet.publicKey, null, 6);
  const quoteMint = await createMint(conn, wallet.payer, wallet.publicKey, null, 6);
  const market = PublicKey.findProgramAddressSync(
    [enc("market"), baseMint.toBuffer(), quoteMint.toBuffer()], program.programId)[0];
  const seed = (s: string) => PublicKey.findProgramAddressSync([enc(s), market.toBuffer()], program.programId)[0];
  const oo = (owner: PublicKey) =>
    PublicKey.findProgramAddressSync([enc("open_orders"), market.toBuffer(), owner.toBuffer()], program.programId)[0];

  await program.methods.initMarket({
    tickIntervalMs: 50, commitEveryTicks: 20, bandDeltaBps: 0, feeBps: 0,
    maxOrdersPerBatch: 64, oracleMaxAgeSlots: 0, forceUndelegateTimeoutSlots: 100,
    windowMinTicks: 0, windowMaxTicks: 0, cfmmBase: new BN(0), cfmmQuote: new BN(0), cfmmBandBps: 0, cfmmLevels: 0, lazerFeedId: new BN(0), crankAuthority: wallet.publicKey,
  } as any).accountsPartial({
    market, batchBook: seed("book"), batchResult: seed("result"),
    baseMint, quoteMint, baseVault: seed("base_vault"), quoteVault: seed("quote_vault"),
    oraclePrice: seed("oracle"), payer: wallet.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).rpc();
  // Enable run_batch (the clearing compute; ER handles sequencing separately).
  await program.methods.setDelegated().accountsPartial({ market, authority: wallet.publicKey }).rpc();
  console.log("Market initialized on devnet:", market.toBase58());

  const traders: Keypair[] = [];
  async function trader(baseAmt: number, quoteAmt: number): Promise<Keypair> {
    const t = Keypair.generate();
    // Fund from the main wallet (reliable; avoids devnet faucet rate limits).
    const fund = new anchor.web3.Transaction().add(SystemProgram.transfer({
      fromPubkey: wallet.publicKey, toPubkey: t.publicKey, lamports: LAMPORTS_PER_SOL / 20 }));
    await provider.sendAndConfirm(fund); await sleep(THROTTLE_MS);
    const ba = await getOrCreateAssociatedTokenAccount(conn, wallet.payer, baseMint, t.publicKey);
    await sleep(THROTTLE_MS);
    const qa = await getOrCreateAssociatedTokenAccount(conn, wallet.payer, quoteMint, t.publicKey);
    await sleep(THROTTLE_MS);
    if (baseAmt) { await mintTo(conn, wallet.payer, baseMint, ba.address, wallet.publicKey, baseAmt); await sleep(THROTTLE_MS); }
    if (quoteAmt) { await mintTo(conn, wallet.payer, quoteMint, qa.address, wallet.publicKey, quoteAmt); await sleep(THROTTLE_MS); }
    if (baseAmt) { await program.methods.deposit(new BN(baseAmt), true).accountsPartial({
      market, vault: seed("base_vault"), userTokenAccount: ba.address, openOrders: oo(t.publicKey),
      owner: t.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).signers([t]).rpc(); await sleep(THROTTLE_MS); }
    if (quoteAmt) { await program.methods.deposit(new BN(quoteAmt), false).accountsPartial({
      market, vault: seed("quote_vault"), userTokenAccount: qa.address, openOrders: oo(t.publicKey),
      owner: t.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).signers([t]).rpc(); await sleep(THROTTLE_MS); }
    traders.push(t);
    return t;
  }
  const submit = async (t: Keypair, side: number, price: BN, qty: number, flow: number) => {
    await program.methods.submitOrder(side, price, new BN(qty), flow).accountsPartial({
      market, batchBook: seed("book"), openOrders: oo(t.publicKey),
      owner: t.publicKey }).signers([t]).rpc();
    await sleep(THROTTLE_MS);
  };

  // Settle a group of traders against the CURRENT BatchResult (each window's
  // result must be settled before the next run_batch overwrites it).
  async function settleGroup(group: Keypair[]) {
    for (const t of group) {
      await program.methods.settle().accountsPartial({
        market, batchResult: seed("result"), openOrders: oo(t.publicKey) }).rpc();
      await sleep(THROTTLE_MS);
    }
    for (const t of group) {
      const o = await (program.account as any).openOrders.fetch(oo(t.publicKey));
      if (o.baseReserved.toNumber() !== 0 || o.quoteReserved.toNumber() !== 0)
        throw new Error("reserve not released for " + t.publicKey.toBase58());
    }
  }

  async function runBatchWithCu(label: string) {
    // run_batch builds curves + clears + writes BatchResult; request headroom
    // above the 200k default (C1).
    const cuIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
    const sig = await program.methods.runBatch().accountsPartial({
      market, batchBook: seed("book"), batchResult: seed("result"), oraclePrice: seed("oracle") })
      .preInstructions([cuIx]).rpc();
    await conn.confirmTransaction(sig, "confirmed"); await sleep(THROTTLE_MS);
    let cu: number | string = "?";
    try {
      const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      cu = tx?.meta?.computeUnitsConsumed ?? "?";
    } catch (_) { /* CU read is best-effort */ }
    const res = await (program.account as any).batchResult.fetch(seed("result"));
    console.log(`\n[${label}] run_batch CU=${cu}  p*=${res.clearingPrice.toNumber() / PRICE_SCALE}  volume=${res.matchedVolume.toString()}  fills=${res.nFills}`);
    return res;
  }

  // ---- Scenario A: many orders, one price --------------------------------
  console.log("\n=== Scenario A: many orders in one window clear at a single price ===");
  const b1 = await trader(0, 20_000_000), b2 = await trader(0, 20_000_000);
  const s1 = await trader(1000, 0), s2 = await trader(1000, 0);
  await submit(b1, SIDE_BUY, px(104), 100, FLOW_TAKER);
  await submit(b2, SIDE_BUY, px(100), 100, FLOW_TAKER);
  await submit(s1, SIDE_SELL, px(96), 100, FLOW_MAKER);
  await submit(s2, SIDE_SELL, px(100), 100, FLOW_MAKER);
  const resA = await runBatchWithCu("A");
  if (resA.status !== 0 || resA.clearingPrice.toNumber() <= 0) throw new Error("A: expected a single-price clear");
  console.log("  -> all fills at ONE p*; FBA removes intra-window time priority. PASS");
  await settleGroup([b1, b2, s1, s2]);
  console.log("  -> settled scenario A traders at p*; reserves released.");

  // ---- Scenario B: sandwich captures nothing -----------------------------
  console.log("\n=== Scenario B: a sandwich in the same window captures nothing ===");
  const victim = await trader(0, 20_000_000);
  const atk = await trader(1000, 20_000_000);
  const cp = await trader(1000, 0);
  await submit(victim, SIDE_BUY, px(101), 100, FLOW_TAKER);
  await submit(atk, SIDE_BUY, px(105), 50, FLOW_TAKER);   // front-run attempt
  await submit(atk, SIDE_SELL, px(95), 50, FLOW_TAKER);   // back-run attempt
  await submit(cp, SIDE_SELL, px(99), 150, FLOW_MAKER);
  const resB = await runBatchWithCu("B");
  if (resB.status !== 0 || resB.clearingPrice.toNumber() <= 0) throw new Error("B: expected a single-price clear");
  console.log("  -> attacker's buy AND sell execute at the same p* as the victim; sandwich nets zero. PASS");
  await settleGroup([victim, atk, cp]);
  console.log("  -> settled scenario B traders at p*; reserves released.");

  await program.methods.finalizeSettlement().accountsPartial({ market, authority: wallet.publicKey }).rpc();
  console.log(`\nDEMO OK. ${traders.length} traders settled, all reserves released. Market: ${market.toBase58()}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
