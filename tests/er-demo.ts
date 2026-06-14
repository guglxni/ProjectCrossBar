/**
 * Project CrossBar FULL Ephemeral Rollup lifecycle on MagicBlock devnet.
 *
 * This is the headline novelty (architecture.md): order submission and the
 * uniform-price clear happen INSIDE the MagicBlock ER, then state commits +
 * undelegates back to Solana L1.
 *
 *   base L1 (https://api.devnet.solana.com):
 *     init_market -> deposit -> set_delegated -> delegate_market
 *                 -> delegate_open_orders (per trader)
 *   ER (https://devnet.magicblock.app):
 *     submit_order (x2) -> run_batch        <-- the auction runs sub-slot in the ER
 *     undelegate_market + undelegate_open_orders   <-- commit canonical state to L1
 *   base L1:
 *     read BatchResult (the ER-computed clearing, now on L1) -> settle
 *
 * Run:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=$HOME/.config/solana/id.json \
 *   npx tsx tests/er-demo.ts
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T = Number(process.env.THROTTLE_MS || 700);
// Default MagicBlock devnet validator identity (from the anchor-counter example).
const VALIDATOR = new PublicKey(process.env.VALIDATOR || "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");

async function main() {
  const idl = JSON.parse(fs.readFileSync(__dirname + "/../target/idl/crossbar.json", "utf8"));
  const base = anchor.AnchorProvider.env();
  anchor.setProvider(base);
  const conn = base.connection;
  const wallet = base.wallet as anchor.Wallet;

  // ER provider/program: same wallet, MagicBlock devnet endpoint.
  const er = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet.magicblock.app/",
      { commitment: "confirmed" }),
    wallet, { commitment: "confirmed" });

  const program = new Program(idl as anchor.Idl, base);
  const erProgram = new Program(idl as anchor.Idl, er);
  const PROGRAM_ID = program.programId;
  console.log("Program:", PROGRAM_ID.toBase58());
  console.log("Base RPC:", conn.rpcEndpoint, "\nER RPC:", er.connection.rpcEndpoint);

  // ---- Base setup --------------------------------------------------------
  const baseMint = await createMint(conn, wallet.payer, wallet.publicKey, null, 6);
  const quoteMint = await createMint(conn, wallet.payer, wallet.publicKey, null, 6);
  const market = PublicKey.findProgramAddressSync([enc("market"), baseMint.toBuffer(), quoteMint.toBuffer()], PROGRAM_ID)[0];
  const seed = (s: string) => PublicKey.findProgramAddressSync([enc(s), market.toBuffer()], PROGRAM_ID)[0];
  const oo = (owner: PublicKey) => PublicKey.findProgramAddressSync([enc("open_orders"), market.toBuffer(), owner.toBuffer()], PROGRAM_ID)[0];

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
  await sleep(T);
  console.log("init_market OK. Market:", market.toBase58());

  const traders: Keypair[] = [];
  async function trader(baseAmt: number, quoteAmt: number) {
    const t = Keypair.generate();
    await base.sendAndConfirm(new anchor.web3.Transaction().add(SystemProgram.transfer({
      fromPubkey: wallet.publicKey, toPubkey: t.publicKey, lamports: LAMPORTS_PER_SOL / 20 }))); await sleep(T);
    const ba = await getOrCreateAssociatedTokenAccount(conn, wallet.payer, baseMint, t.publicKey); await sleep(T);
    const qa = await getOrCreateAssociatedTokenAccount(conn, wallet.payer, quoteMint, t.publicKey); await sleep(T);
    if (baseAmt) { await mintTo(conn, wallet.payer, baseMint, ba.address, wallet.publicKey, baseAmt); await sleep(T);
      await program.methods.deposit(new BN(baseAmt), true).accountsPartial({ market, vault: seed("base_vault"),
        userTokenAccount: ba.address, openOrders: oo(t.publicKey), owner: t.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).signers([t]).rpc(); await sleep(T); }
    if (quoteAmt) { await mintTo(conn, wallet.payer, quoteMint, qa.address, wallet.publicKey, quoteAmt); await sleep(T);
      await program.methods.deposit(new BN(quoteAmt), false).accountsPartial({ market, vault: seed("quote_vault"),
        userTokenAccount: qa.address, openOrders: oo(t.publicKey), owner: t.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).signers([t]).rpc(); await sleep(T); }
    traders.push(t);
    return t;
  }
  const buyer = await trader(0, 20_000_000);
  const seller = await trader(1000, 0);
  console.log("Funded 2 traders (buyer, seller).");

  // ---- Delegate the full set to the ER -----------------------------------
  // Delegating 4 PDAs = 4 CPIs to the delegation program; bump CU above 200k.
  const cuMax = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  await program.methods.setDelegated().accountsPartial({ market, authority: wallet.publicKey }).rpc(); await sleep(T);
  const valMeta = [{ pubkey: VALIDATOR, isSigner: false, isWritable: false }];
  await program.methods.delegateMarket().accountsPartial({
    payer: wallet.publicKey, authority: wallet.publicKey, baseMint, quoteMint, market,
    book: seed("book"), result: seed("result"), oracle: seed("oracle"),
  }).remainingAccounts(valMeta).preInstructions([cuMax]).rpc(); await sleep(T);
  for (const t of traders) {
    await program.methods.delegateOpenOrders(t.publicKey).accountsPartial({
      payer: wallet.publicKey, authority: wallet.publicKey, market, openOrders: oo(t.publicKey),
    }).remainingAccounts(valMeta).preInstructions([cuMax]).rpc(); await sleep(T);
  }
  console.log("Delegated Market+book+result+oracle + 2 OpenOrders to the ER. Waiting for ER to pick up...");
  await sleep(5000);

  // ---- Inside the ER: submit + clear -------------------------------------
  const submitER = async (t: Keypair, side: number, p: BN, qty: number, flow: number) => {
    await erProgram.methods.submitOrder(side, p, new BN(qty), flow).accountsPartial({
      market, batchBook: seed("book"), openOrders: oo(t.publicKey),
      owner: t.publicKey }).signers([t]).rpc(); await sleep(T);
  };
  await submitER(buyer, SIDE_BUY, px(101), 100, FLOW_TAKER);
  await submitER(seller, SIDE_SELL, px(99), 100, FLOW_MAKER);
  console.log("Submitted 2 crossing orders INSIDE the ER.");
  // Diagnostic: confirm the orders landed in the ER's view of the book.
  try {
    const bk = await (erProgram.account as any).batchBook.fetch(seed("book"));
    console.log(`  [ER] batch_book n_orders=${bk.nOrders} window=${bk.window}`);
  } catch (e) { console.log("  [ER] book fetch:", String(e).slice(0, 120)); }

  const cuIx = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
  await erProgram.methods.runBatch().accountsPartial({
    market, batchBook: seed("book"), batchResult: seed("result"), oraclePrice: seed("oracle"),
  }).preInstructions([cuIx]).rpc(); await sleep(T);
  console.log("run_batch executed INSIDE the ER (sub-slot, protocol-sequenced).");
  try {
    const r = await (erProgram.account as any).batchResult.fetch(seed("result"));
    console.log(`  [ER] BatchResult status=${r.status} p*=${r.clearingPrice} vol=${r.matchedVolume} fills=${r.nFills}`);
  } catch (e) { console.log("  [ER] result fetch:", String(e).slice(0, 120)); }

  // ---- Undelegate back to L1 ---------------------------------------------
  await erProgram.methods.undelegateMarket().accountsPartial({
    payer: wallet.publicKey, authority: wallet.publicKey, market, batchBook: seed("book"),
    batchResult: seed("result"), oraclePrice: seed("oracle") }).preInstructions([cuMax]).rpc(); await sleep(2000);
  for (const t of traders) {
    await erProgram.methods.undelegateOpenOrders().accountsPartial({
      payer: wallet.publicKey, openOrders: oo(t.publicKey) }).preInstructions([cuMax]).rpc(); await sleep(T);
  }
  console.log("Committed + undelegated all state from ER back to Solana L1.");
  await sleep(4000);

  // ---- Read the ER-computed clearing on L1, then settle ------------------
  // The undelegation commit takes a few seconds to land on L1; poll until the
  // cleared BatchResult (computed in the ER) appears on base.
  let res: any = null;
  for (let i = 0; i < 20; i++) {
    res = await (program.account as any).batchResult.fetch(seed("result"));
    if (res.status === 0 && res.clearingPrice.toNumber() > 0) break;
    await sleep(3000);
  }
  console.log(`\nON L1: BatchResult from the ER clear -> p*=${res.clearingPrice.toNumber()/PRICE_SCALE} volume=${res.matchedVolume} fills=${res.nFills} status=${res.status}`);
  if (res.status !== 0 || res.clearingPrice.toNumber() <= 0) throw new Error("expected a cleared single-price BatchResult on L1");

  for (const t of traders) {
    await program.methods.settle().accountsPartial({
      market, batchResult: seed("result"), openOrders: oo(t.publicKey) }).rpc(); await sleep(T);
  }
  await program.methods.finalizeSettlement().accountsPartial({ market, authority: wallet.publicKey }).rpc();
  for (const t of traders) {
    const o = await (program.account as any).openOrders.fetch(oo(t.publicKey));
    if (o.baseReserved.toNumber() !== 0 || o.quoteReserved.toNumber() !== 0) throw new Error("reserve not released");
  }
  console.log("Settled both traders on L1; reserves released.");
  console.log("\nER ROUND-TRIP OK: auction ran inside the MagicBlock ER, settled atomically to Solana L1.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
