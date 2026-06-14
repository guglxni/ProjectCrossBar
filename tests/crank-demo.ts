/**
 * Project CrossBar AUTOMATIC CRANK demo on MagicBlock devnet.
 *
 * Proves the heartbeat: after delegation, `schedule_batch` registers a
 * MagicBlock scheduled task (ScheduleTask CPI) that fires `run_batch`
 * automatically inside the ER every `tick_interval_ms` - no user/explicit call.
 * Orders submitted into the ER are cleared by the crank, then a minimal SETTLE
 * KEEPER undelegates + settles each trader on L1 and finalizes - the deliberate
 * two-step pattern (clear in ER, settle on L1) every MagicBlock example uses.
 * One command runs the whole lifecycle end to end.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=$HOME/.config/solana/id.json \
 *   npx tsx tests/crank-demo.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { MAGIC_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import * as fs from "fs";

const PRICE_SCALE = 1_000_000;
const SIDE_BUY = 0, SIDE_SELL = 1, FLOW_MAKER = 0, FLOW_TAKER = 1;
const enc = (s: string) => Buffer.from(s);
const px = (p: number) => new BN(Math.round(p * PRICE_SCALE));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T = Number(process.env.THROTTLE_MS || 700);
const VALIDATOR = new PublicKey(process.env.VALIDATOR || "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");

async function waitForOwner(
  conn: anchor.web3.Connection,
  pubkey: PublicKey,
  owner: PublicKey,
  label: string,
  attempts = 25,
) {
  for (let i = 0; i < attempts; i++) {
    const info = await conn.getAccountInfo(pubkey);
    if (info?.owner.equals(owner)) return;
    await sleep(3000);
  }
  throw new Error(`${label} did not return to ${owner.toBase58()} on L1`);
}

async function main() {
  const idl = JSON.parse(fs.readFileSync(__dirname + "/../target/idl/crossbar.json", "utf8"));
  const base = anchor.AnchorProvider.env();
  anchor.setProvider(base);
  const conn = base.connection;
  const wallet = base.wallet as anchor.Wallet;
  const er = new anchor.AnchorProvider(
    new anchor.web3.Connection(process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet.magicblock.app/", { commitment: "confirmed" }),
    wallet, { commitment: "confirmed" });
  const program = new Program(idl as anchor.Idl, base);
  const erProgram = new Program(idl as anchor.Idl, er);
  const PID = program.programId;

  const baseMint = await createMint(conn, wallet.payer, wallet.publicKey, null, 6);
  const quoteMint = await createMint(conn, wallet.payer, wallet.publicKey, null, 6);
  const market = PublicKey.findProgramAddressSync([enc("market"), baseMint.toBuffer(), quoteMint.toBuffer()], PID)[0];
  const seed = (s: string) => PublicKey.findProgramAddressSync([enc(s), market.toBuffer()], PID)[0];
  const oo = (o: PublicKey) => PublicKey.findProgramAddressSync([enc("open_orders"), market.toBuffer(), o.toBuffer()], PID)[0];

  await program.methods.initMarket({
    tickIntervalMs: 50, commitEveryTicks: 20, bandDeltaBps: 0, feeBps: 0,
    maxOrdersPerBatch: 64, oracleMaxAgeSlots: 0, forceUndelegateTimeoutSlots: 100,
    windowMinTicks: 0, windowMaxTicks: 0, cfmmBase: new BN(0), cfmmQuote: new BN(0), cfmmBandBps: 0, cfmmLevels: 0, lazerFeedId: new BN(0), crankAuthority: wallet.publicKey,
  } as any).accountsPartial({
    market, batchBook: seed("book"), batchResult: seed("result"), baseMint, quoteMint,
    baseVault: seed("base_vault"), quoteVault: seed("quote_vault"), oraclePrice: seed("oracle"),
    payer: wallet.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).rpc(); await sleep(T);
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

  // Delegate the full set to the ER.
  const cuMax = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  await program.methods.setDelegated().accountsPartial({ market, authority: wallet.publicKey }).rpc(); await sleep(T);
  const valMeta = [{ pubkey: VALIDATOR, isSigner: false, isWritable: false }];
  await program.methods.delegateMarket().accountsPartial({ payer: wallet.publicKey, authority: wallet.publicKey, baseMint, quoteMint, market,
    book: seed("book"), result: seed("result"), oracle: seed("oracle") }).remainingAccounts(valMeta).preInstructions([cuMax]).rpc(); await sleep(T);
  for (const t of traders) await program.methods.delegateOpenOrders(t.publicKey)
    .accountsPartial({ payer: wallet.publicKey, authority: wallet.publicKey, market, openOrders: oo(t.publicKey) }).remainingAccounts(valMeta).preInstructions([cuMax]).rpc();
  console.log("Delegated to ER. Waiting for pickup..."); await sleep(5000);

  // Submit crossing orders INSIDE the ER (before registering the crank).
  const submitER = async (t: Keypair, side: number, p: BN, qty: number, flow: number) =>
    erProgram.methods.submitOrder(side, p, new BN(qty), flow).accountsPartial({ market, batchBook: seed("book"),
      openOrders: oo(t.publicKey), owner: t.publicKey }).signers([t]).rpc().then(() => sleep(T));
  await submitER(buyer, SIDE_BUY, px(101), 100, FLOW_TAKER);
  await submitER(seller, SIDE_SELL, px(99), 100, FLOW_MAKER);
  console.log("Submitted 2 crossing orders into the ER.");

  // Register the crank: fire run_batch ONCE, ~2s out, to clear the window.
  const schedTx = await erProgram.methods.scheduleBatch({
    taskId: new BN(1), executionIntervalMillis: new BN(2000), iterations: new BN(1),
  }).accountsPartial({
    magicProgram: MAGIC_PROGRAM_ID, payer: wallet.publicKey, authority: wallet.publicKey, market,
    batchBook: seed("book"), batchResult: seed("result"), oraclePrice: seed("oracle"), program: PID,
  }).transaction();
  schedTx.feePayer = wallet.publicKey;
  schedTx.recentBlockhash = (await er.connection.getLatestBlockhash()).blockhash;
  const signed = await wallet.signTransaction(schedTx);
  const schedSig = await er.sendAndConfirm(signed, [], { skipPreflight: true, commitment: "confirmed" });
  console.log("schedule_batch registered the crank (ScheduleTask). tx:", schedSig);

  // Wait for the CRANK to fire run_batch automatically (no explicit call).
  console.log("Waiting for the crank to fire run_batch automatically...");
  let res: any = null;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    res = await (erProgram.account as any).batchResult.fetch(seed("result"));
    if (res.status === 0 && res.clearingPrice.toNumber() > 0) break;
  }
  console.log(`[ER] BatchResult after crank: status=${res.status} p*=${res.clearingPrice} vol=${res.matchedVolume} fills=${res.nFills}`);
  if (res.status !== 0 || res.clearingPrice.toNumber() <= 0)
    throw new Error("crank did not auto-clear the batch");
  console.log("CRANK OK: run_batch fired automatically inside the ER and cleared the window at one p*.");

  // ---- Undelegate, then run the SETTLE KEEPER on L1 ----------------------
  // Settlement is a DELIBERATE L1 step AFTER the ER clears — the same two-step
  // pattern every MagicBlock example uses (e.g. rock-paper-scissor's
  // `undelegate_all` -> `claim_pot`): undelegate first, then a base-layer
  // follow-up. Here a tiny keeper loops the traders, settles each against the
  // committed BatchResult at p*, and flips the market back to OnBase. No new
  // on-chain dependency; one command runs the whole lifecycle.
  await erProgram.methods.undelegateMarket().accountsPartial({ payer: wallet.publicKey, authority: wallet.publicKey, market,
    batchBook: seed("book"), batchResult: seed("result"), oraclePrice: seed("oracle") }).preInstructions([cuMax]).rpc(); await sleep(2000);
  for (const t of traders) { await erProgram.methods.undelegateOpenOrders()
    .accountsPartial({ payer: wallet.publicKey, openOrders: oo(t.publicKey) }).preInstructions([cuMax]).rpc(); await sleep(T); }
  console.log("Undelegated Market + OpenOrders back to L1. Running the settle keeper...");

  // The undelegation commit takes a few seconds to land on L1; wait for the
  // cleared BatchResult to appear on base before settling.
  let onL1: any = null;
  for (let i = 0; i < 20; i++) {
    onL1 = await (program.account as any).batchResult.fetch(seed("result")).catch(() => null);
    if (onL1 && onL1.status === 0 && onL1.clearingPrice.toNumber() > 0) break;
    await sleep(3000);
  }
  if (!onL1 || onL1.status !== 0) throw new Error("cleared BatchResult did not land on L1");

  // Wait for the delegation program to release account ownership before settle.
  await waitForOwner(conn, market, PID, "market");
  for (const t of traders)
    await waitForOwner(conn, oo(t.publicKey), PID, `open_orders(${t.publicKey.toBase58().slice(0, 8)})`);

  // The keeper: settle each trader on L1 (one-shot per trader via the C1 cursor),
  // then finalize. Tip: point a Kora paymaster at these txs for gasless keeper
  // settlement — that's UX polish, not a change to the lifecycle.
  for (const t of traders) {
    await program.methods.settle().accountsPartial({ market, batchResult: seed("result"), openOrders: oo(t.publicKey) }).rpc();
    await sleep(T);
  }
  await program.methods.finalizeSettlement().accountsPartial({ market, authority: wallet.publicKey }).rpc();
  for (const t of traders) {
    const o = await (program.account as any).openOrders.fetch(oo(t.publicKey));
    if (o.baseReserved.toNumber() !== 0 || o.quoteReserved.toNumber() !== 0) throw new Error("reserve not released after settle");
  }
  console.log(`Settle keeper: ${traders.length} traders settled on L1 at p*, reserves released; market back to OnBase.`);
  console.log("CRANK DEMO OK: crank cleared inside the ER, the keeper settled to L1 — full lifecycle in one command.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
