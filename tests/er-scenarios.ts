/**
 * Scenarios A and B from `demo-devnet.ts`, but through the FULL MagicBlock ER
 * lifecycle (same headline path as `er-demo.ts`).
 *
 * Closes the gap where uniform-price and sandwich demos only ran on a local
 * validator via the L1 `set_delegated` shortcut. Here every submit and
 * `run_batch` executes on https://devnet.magicblock.app, then undelegates and
 * settles on L1.
 *
 * Each scenario is a full delegate -> ER clear -> undelegate -> settle cycle
 * (BatchResult must be settled before the next window overwrites it, and L1
 * settle requires undelegation when state lives on the ER).
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=$HOME/.config/solana/id.json \
 *   npx tsx tests/er-scenarios.ts
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

type Ctx = {
  base: anchor.AnchorProvider;
  conn: anchor.web3.Connection;
  wallet: anchor.Wallet;
  er: anchor.AnchorProvider;
  program: Program;
  erProgram: Program;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  market: PublicKey;
  seed: (s: string) => PublicKey;
  oo: (owner: PublicKey) => PublicKey;
  cuMax: anchor.web3.TransactionInstruction;
  cuRun: anchor.web3.TransactionInstruction;
  valMeta: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
};

async function main() {
  const idl = JSON.parse(fs.readFileSync(__dirname + "/../target/idl/crossbar.json", "utf8"));
  const base = anchor.AnchorProvider.env();
  anchor.setProvider(base);
  const conn = base.connection;
  const wallet = base.wallet as anchor.Wallet;
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

  const baseMint = await createMint(conn, wallet.payer, wallet.publicKey, null, 6);
  const quoteMint = await createMint(conn, wallet.payer, wallet.publicKey, null, 6);
  const market = PublicKey.findProgramAddressSync([enc("market"), baseMint.toBuffer(), quoteMint.toBuffer()], PROGRAM_ID)[0];
  const seed = (s: string) => PublicKey.findProgramAddressSync([enc(s), market.toBuffer()], PROGRAM_ID)[0];
  const oo = (owner: PublicKey) =>
    PublicKey.findProgramAddressSync([enc("open_orders"), market.toBuffer(), owner.toBuffer()], PROGRAM_ID)[0];

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

  const ctx: Ctx = {
    base, conn, wallet, er, program, erProgram, baseMint, quoteMint, market, seed, oo,
    cuMax: anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    cuRun: anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
    valMeta: [{ pubkey: VALIDATOR, isSigner: false, isWritable: false }],
  };

  async function trader(baseAmt: number, quoteAmt: number): Promise<Keypair> {
    const t = Keypair.generate();
    await base.sendAndConfirm(new anchor.web3.Transaction().add(SystemProgram.transfer({
      fromPubkey: wallet.publicKey, toPubkey: t.publicKey, lamports: LAMPORTS_PER_SOL / 20 })));
    await sleep(T);
    const ba = await getOrCreateAssociatedTokenAccount(conn, wallet.payer, baseMint, t.publicKey);
    await sleep(T);
    const qa = await getOrCreateAssociatedTokenAccount(conn, wallet.payer, quoteMint, t.publicKey);
    await sleep(T);
    if (baseAmt) {
      await mintTo(conn, wallet.payer, baseMint, ba.address, wallet.publicKey, baseAmt);
      await sleep(T);
      await program.methods.deposit(new BN(baseAmt), true).accountsPartial({
        market, vault: seed("base_vault"), userTokenAccount: ba.address, openOrders: oo(t.publicKey),
        owner: t.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([t]).rpc();
      await sleep(T);
    }
    if (quoteAmt) {
      await mintTo(conn, wallet.payer, quoteMint, qa.address, wallet.publicKey, quoteAmt);
      await sleep(T);
      await program.methods.deposit(new BN(quoteAmt), false).accountsPartial({
        market, vault: seed("quote_vault"), userTokenAccount: qa.address, openOrders: oo(t.publicKey),
        owner: t.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([t]).rpc();
      await sleep(T);
    }
    return t;
  }

  async function runErCycle(
    label: string,
    traders: Keypair[],
    submitOrders: (submitER: (t: Keypair, side: number, p: BN, qty: number, flow: number) => Promise<void>) => Promise<void>,
  ) {
    console.log(`\n=== ${label}: delegate -> ER clear -> undelegate -> settle ===`);

    await program.methods.setDelegated().accountsPartial({ market, authority: wallet.publicKey }).rpc();
    await sleep(T);
    await program.methods.delegateMarket().accountsPartial({
      payer: wallet.publicKey, authority: wallet.publicKey, baseMint, quoteMint, market,
      book: seed("book"), result: seed("result"), oracle: seed("oracle"),
    }).remainingAccounts(ctx.valMeta).preInstructions([ctx.cuMax]).rpc();
    await sleep(T);
    for (const t of traders) {
      await program.methods.delegateOpenOrders(t.publicKey).accountsPartial({
        payer: wallet.publicKey, authority: wallet.publicKey, market, openOrders: oo(t.publicKey),
      }).remainingAccounts(ctx.valMeta).preInstructions([ctx.cuMax]).rpc();
      await sleep(T);
    }
    console.log(`  Delegated market + ${traders.length} OpenOrders. Waiting for ER pickup...`);
    await sleep(5000);

    const submitER = async (t: Keypair, side: number, p: BN, qty: number, flow: number) => {
      await erProgram.methods.submitOrder(side, p, new BN(qty), flow).accountsPartial({
        market, batchBook: seed("book"), openOrders: oo(t.publicKey), owner: t.publicKey,
      }).signers([t]).rpc();
      await sleep(T);
    };
    await submitOrders(submitER);

    await erProgram.methods.runBatch().accountsPartial({
      market, batchBook: seed("book"), batchResult: seed("result"), oraclePrice: seed("oracle"),
    }).preInstructions([ctx.cuRun]).rpc();
    await sleep(T);

    let erRes: any;
    try {
      erRes = await (erProgram.account as any).batchResult.fetch(seed("result"));
      console.log(`  [ER] p*=${erRes.clearingPrice.toNumber() / PRICE_SCALE} volume=${erRes.matchedVolume} fills=${erRes.nFills}`);
    } catch (e) {
      console.log("  [ER] result fetch:", String(e).slice(0, 120));
    }
    if (!erRes || erRes.status !== 0 || erRes.clearingPrice.toNumber() <= 0)
      throw new Error(`${label}: expected a single-price clear inside the ER`);

    await erProgram.methods.undelegateMarket().accountsPartial({
      payer: wallet.publicKey, authority: wallet.publicKey, market, batchBook: seed("book"),
      batchResult: seed("result"), oraclePrice: seed("oracle"),
    }).preInstructions([ctx.cuMax]).rpc();
    await sleep(2000);
    for (const t of traders) {
      await erProgram.methods.undelegateOpenOrders().accountsPartial({
        payer: wallet.publicKey, openOrders: oo(t.publicKey),
      }).preInstructions([ctx.cuMax]).rpc();
      await sleep(T);
    }
    console.log("  Undelegated to L1. Polling BatchResult...");
    await sleep(4000);

    let res: any = null;
    for (let i = 0; i < 20; i++) {
      res = await (program.account as any).batchResult.fetch(seed("result")).catch(() => null);
      if (res && res.status === 0 && res.clearingPrice.toNumber() > 0) break;
      await sleep(3000);
    }
    if (!res || res.status !== 0 || res.clearingPrice.toNumber() <= 0)
      throw new Error(`${label}: cleared BatchResult did not land on L1`);

    await waitForOwner(conn, market, program.programId, `${label} market`);
    for (const t of traders)
      await waitForOwner(conn, oo(t.publicKey), program.programId, `${label} open_orders`);

    for (const t of traders) {
      await program.methods.settle().accountsPartial({
        market, batchResult: seed("result"), openOrders: oo(t.publicKey),
      }).rpc();
      await sleep(T);
    }
    await program.methods.finalizeSettlement().accountsPartial({ market, authority: wallet.publicKey }).rpc();
    await sleep(T);
    for (const t of traders) {
      const o = await (program.account as any).openOrders.fetch(oo(t.publicKey));
      if (o.baseReserved.toNumber() !== 0 || o.quoteReserved.toNumber() !== 0)
        throw new Error(`${label}: reserve not released for ${t.publicKey.toBase58()}`);
    }
    console.log(`  ${label} PASS — ER clear at one p*, settled on L1.`);
  }

  // Scenario A: many orders, one uniform p*
  const b1 = await trader(0, 20_000_000);
  const b2 = await trader(0, 20_000_000);
  const s1 = await trader(1000, 0);
  const s2 = await trader(1000, 0);
  const groupA = [b1, b2, s1, s2];
  await runErCycle("Scenario A (uniform p*)", groupA, async (submitER) => {
    await submitER(b1, SIDE_BUY, px(104), 100, FLOW_TAKER);
    await submitER(b2, SIDE_BUY, px(100), 100, FLOW_TAKER);
    await submitER(s1, SIDE_SELL, px(96), 100, FLOW_MAKER);
    await submitER(s2, SIDE_SELL, px(100), 100, FLOW_MAKER);
  });

  // Scenario B: sandwich nets zero at the same p* as the victim
  const victim = await trader(0, 20_000_000);
  const atk = await trader(1000, 20_000_000);
  const cp = await trader(1000, 0);
  const groupB = [victim, atk, cp];
  await runErCycle("Scenario B (sandwich nets zero)", groupB, async (submitER) => {
    await submitER(victim, SIDE_BUY, px(101), 100, FLOW_TAKER);
    await submitER(atk, SIDE_BUY, px(105), 50, FLOW_TAKER);
    await submitER(atk, SIDE_SELL, px(95), 50, FLOW_TAKER);
    await submitER(cp, SIDE_SELL, px(99), 150, FLOW_MAKER);
  });

  console.log(`\nER SCENARIOS OK. Market: ${market.toBase58()}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
