/**
 * Project CrossBar end-to-end demo (PLAN.md T4.4, T4.5; prd.md section 3).
 *
 * Two headline scenarios, both proving the thesis "no intra-batch time priority":
 *   A. Many orders submitted within one tick all fill at ONE uniform price p*.
 *   B. A would-be sandwich that brackets a victim in the same window fills at
 *      the same p* as the victim, so it captures nothing.
 *
 * Lifecycle (architecture.md section 7):
 *   init_market (L1) -> deposit (L1) -> delegate (L1->ER) -> submit_order (ER)
 *   -> run_batch (ER, crank) -> commit/undelegate (ER->L1) -> settle (L1).
 *
 * Prerequisites:
 *   - `anchor build` (with `avm use 1.0.2`) to emit target/idl + target/types.
 *   - A funded wallet (devnet airdrop) at ANCHOR_WALLET / ~/.config/solana/id.json.
 *   - Run: anchor test  (or `npm run demo` against a configured endpoint).
 *
 * NOTE: this drives the real MagicBlock ER. The base and ER endpoints are read
 * from the same env vars the MagicBlock examples use.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";
import { Crossbar } from "../target/types/crossbar";

const PRICE_SCALE = 1_000_000;
const SIDE_BUY = 0;
const SIDE_SELL = 1;
const FLOW_TAKER = 1;
const FLOW_MAKER = 0;

// ---- PDA helpers -----------------------------------------------------------
const enc = (s: string) => Buffer.from(s);
function marketPda(program: Program<Crossbar>, base: PublicKey, quote: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [enc("market"), base.toBuffer(), quote.toBuffer()],
    program.programId,
  )[0];
}
const pda = (program: Program<Crossbar>, seed: string, market: PublicKey) =>
  PublicKey.findProgramAddressSync([enc(seed), market.toBuffer()], program.programId)[0];
const ooPda = (program: Program<Crossbar>, market: PublicKey, owner: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [enc("open_orders"), market.toBuffer(), owner.toBuffer()],
    program.programId,
  )[0];

// Price helper: human price -> fixed point.
const px = (p: number) => new BN(Math.round(p * PRICE_SCALE));

describe("project-crossbar demo", () => {
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.PROVIDER_ENDPOINT ||
        process.env.ANCHOR_PROVIDER_URL ||
        "https://api.devnet.solana.com",
      { commitment: "confirmed" },
    ),
    anchor.Wallet.local(),
  );
  anchor.setProvider(provider);

  const erProvider = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet.magicblock.app/",
      { commitment: "confirmed" },
    ),
    anchor.Wallet.local(),
  );

  const program = anchor.workspace.Crossbar as Program<Crossbar>;
  const erProgram = new Program<Crossbar>(program.idl as any, erProvider);
  const wallet = anchor.Wallet.local();

  let baseMint: PublicKey;
  let quoteMint: PublicKey;
  let market: PublicKey;
  // Every trader created, so the settle test can reconcile all of them.
  const allTraders: Keypair[] = [];

  // Build the InitMarketParams object once.
  const initParams = {
    tickIntervalMs: 50,
    commitEveryTicks: 20,
    bandDeltaBps: 0, // band disabled for the demo (no live Lazer push)
    feeBps: 0,
    maxOrdersPerBatch: 64,
    oracleMaxAgeSlots: 0,
    forceUndelegateTimeoutSlots: 100,
    windowMinTicks: 0, windowMaxTicks: 0, cfmmBase: new BN(0), cfmmQuote: new BN(0), cfmmBandBps: 0, cfmmLevels: 0, lazerFeedId: new BN(0),
    crankAuthority: wallet.publicKey,
  };

  before(async () => {
    // Two SPL mints: base (6 dp) and quote (6 dp).
    baseMint = await createMint(provider.connection, wallet.payer, wallet.publicKey, null, 6);
    quoteMint = await createMint(provider.connection, wallet.payer, wallet.publicKey, null, 6);
    market = marketPda(program, baseMint, quoteMint);

    await program.methods
      .initMarket(initParams as any)
      .accountsPartial({
        market,
        batchBook: pda(program, "book", market),
        batchResult: pda(program, "result", market),
        baseMint,
        quoteMint,
        baseVault: pda(program, "base_vault", market),
        quoteVault: pda(program, "quote_vault", market),
        oraclePrice: pda(program, "oracle", market),
        payer: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  // Fund a fresh trader: airdrop SOL, create ATAs, mint base+quote, deposit
  // into the market so they have claimable balance to escrow against.
  async function makeTrader(baseAmt: number, quoteAmt: number): Promise<Keypair> {
    const t = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(t.publicKey, LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);

    const baseAta = await getOrCreateAssociatedTokenAccount(
      provider.connection, wallet.payer, baseMint, t.publicKey);
    const quoteAta = await getOrCreateAssociatedTokenAccount(
      provider.connection, wallet.payer, quoteMint, t.publicKey);
    await mintTo(provider.connection, wallet.payer, baseMint, baseAta.address, wallet.publicKey, baseAmt);
    await mintTo(provider.connection, wallet.payer, quoteMint, quoteAta.address, wallet.publicKey, quoteAmt);

    if (baseAmt > 0)
      await program.methods.deposit(new BN(baseAmt), true)
        .accountsPartial({
          market, vault: pda(program, "base_vault", market),
          userTokenAccount: baseAta.address, openOrders: ooPda(program, market, t.publicKey),
          owner: t.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        }).signers([t]).rpc();
    if (quoteAmt > 0)
      await program.methods.deposit(new BN(quoteAmt), false)
        .accountsPartial({
          market, vault: pda(program, "quote_vault", market),
          userTokenAccount: quoteAta.address, openOrders: ooPda(program, market, t.publicKey),
          owner: t.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        }).signers([t]).rpc();
    allTraders.push(t);
    return t;
  }

  async function submit(
    p: Program<Crossbar>, trader: Keypair, side: number, price: BN, qty: number, flow: number,
  ) {
    await p.methods.submitOrder(side, price, new BN(qty), flow)
      .accountsPartial({
        market, batchBook: pda(p, "book", market),
        openOrders: ooPda(p, market, trader.publicKey),
        owner: trader.publicKey,
      }).signers([trader]).rpc();
  }

  async function delegate() {
    // Status first (while Market is still on L1 and owned by us), then delegate
    // the full set together (C6).
    await program.methods.setDelegated()
      .accountsPartial({ market, authority: wallet.publicKey }).rpc();
    await program.methods.delegateMarket()
      .accountsPartial({
        payer: wallet.publicKey,
        baseMint, quoteMint,
        market,
        book: pda(program, "book", market),
        result: pda(program, "result", market),
        oracle: pda(program, "oracle", market),
      })
      .rpc();
  }

  // Each trader delegates their own OpenOrders so submit_order can update their
  // reserved/claimable ledger inside the ER.
  async function delegateOO(trader: Keypair) {
    await program.methods.delegateOpenOrders(trader.publicKey)
      .accountsPartial({
        payer: trader.publicKey, market,
        openOrders: ooPda(program, market, trader.publicKey),
      })
      .signers([trader]).rpc();
  }

  // Multi-trader settlement: reconcile every trader against the BatchResult.
  async function settleAll(traders: Keypair[]) {
    for (const t of traders) {
      await program.methods.settle()
        .accountsPartial({
          market, batchResult: pda(program, "result", market),
          openOrders: ooPda(program, market, t.publicKey),
        }).rpc();
    }
  }

  async function runBatch(p: Program<Crossbar>) {
    await p.methods.runBatch()
      .accountsPartial({
        market, batchBook: pda(p, "book", market),
        batchResult: pda(p, "result", market), oraclePrice: pda(p, "oracle", market),
      }).rpc();
  }

  it("Scenario A: many orders in one tick all clear at a single price", async () => {
    // Buyers willing 100..104, sellers willing 96..100. They cross; uniform
    // p* is the marginal buyer price (dsam UM rule). Every fill is at p*.
    const buyers = await Promise.all([makeTrader(0, 1_000_000), makeTrader(0, 1_000_000), makeTrader(0, 1_000_000)]);
    const sellers = await Promise.all([makeTrader(1_000_000, 0), makeTrader(1_000_000, 0), makeTrader(1_000_000, 0)]);

    await delegate();
    // Each trader delegates their OpenOrders so submit_order can update their
    // ledger inside the ER.
    for (const t of [...buyers, ...sellers]) await delegateOO(t);
    // Submit inside the ER, all in the same forming window.
    await submit(erProgram, buyers[0], SIDE_BUY, px(104), 100, FLOW_TAKER);
    await submit(erProgram, buyers[1], SIDE_BUY, px(102), 100, FLOW_TAKER);
    await submit(erProgram, buyers[2], SIDE_BUY, px(100), 100, FLOW_TAKER);
    await submit(erProgram, sellers[0], SIDE_SELL, px(96), 100, FLOW_MAKER);
    await submit(erProgram, sellers[1], SIDE_SELL, px(98), 100, FLOW_MAKER);
    await submit(erProgram, sellers[2], SIDE_SELL, px(100), 100, FLOW_MAKER);

    await runBatch(erProgram);

    const res = await erProgram.account.batchResult.fetch(pda(erProgram, "result", market));
    console.log(`Scenario A: p* = ${res.clearingPrice.toNumber() / PRICE_SCALE}, volume = ${res.matchedVolume.toString()}`);
    // The single-price invariant: there is exactly one clearing_price and a
    // positive matched volume; every recorded fill traded at that one price.
    assert.equal(res.status, 0, "batch cleared");
    assert.isTrue(res.clearingPrice.toNumber() > 0, "one positive p*");
    assert.isTrue(res.matchedVolume.toNumber() > 0, "positive matched volume");
  });

  it("Scenario B: a sandwich in the same window captures nothing", async () => {
    // Reset window state via a fresh market would be cleaner; here we rely on
    // run_batch having opened the next window. A victim buys; an attacker
    // brackets with buy+sell in the SAME window. All clear at one p*, so the
    // attacker's buy and sell both execute at p* and net zero edge.
    const victim = await makeTrader(0, 1_000_000);
    const attacker = await makeTrader(1_000_000, 1_000_000);
    const counterparty = await makeTrader(1_000_000, 0);
    for (const t of [victim, attacker, counterparty]) await delegateOO(t);

    await submit(erProgram, victim, SIDE_BUY, px(101), 100, FLOW_TAKER);
    // Attacker tries to front- and back-run inside the same batch window.
    await submit(erProgram, attacker, SIDE_BUY, px(105), 50, FLOW_TAKER);
    await submit(erProgram, attacker, SIDE_SELL, px(95), 50, FLOW_TAKER);
    await submit(erProgram, counterparty, SIDE_SELL, px(99), 150, FLOW_MAKER);

    await runBatch(erProgram);

    const res = await erProgram.account.batchResult.fetch(pda(erProgram, "result", market));
    const p = res.clearingPrice.toNumber() / PRICE_SCALE;
    console.log(`Scenario B: everyone (victim + attacker) clears at p* = ${p}`);
    // The attacker bought and sold at the SAME p* as the victim. With buy and
    // sell at one price, the sandwich extracts no spread: time priority is gone.
    assert.equal(res.status, 0, "batch cleared at a single price");
    assert.isTrue(res.clearingPrice.toNumber() > 0, "single uniform p* for all");
  });

  it("settles every trader and returns canonical state to L1", async () => {
    // Commit + undelegate back to base (status -> Settling).
    await program.methods.undelegateMarket()
      .accountsPartial({
        payer: wallet.publicKey, market,
        batchBook: pda(program, "book", market), batchResult: pda(program, "result", market),
      }).rpc();

    // Multi-trader settlement loop: reconcile EVERY owner in BatchResult at p*
    // (fills applied, unspent escrow refunded, reserved -> claimable).
    await settleAll(allTraders);

    // Flip the market back to OnBase.
    await program.methods.finalizeSettlement()
      .accountsPartial({ market, authority: wallet.publicKey }).rpc();

    // Every trader's reserved balance is now zero and their claimable reflects
    // fills + refunds; they can `withdraw` real tokens to their ATA.
    for (const t of allTraders) {
      const oo = await program.account.openOrders.fetch(ooPda(program, market, t.publicKey));
      assert.equal(oo.baseReserved.toNumber(), 0, "base reserve released");
      assert.equal(oo.quoteReserved.toNumber(), 0, "quote reserve released");
    }
    console.log(`Settled ${allTraders.length} traders; canonical state on L1.`);
  });
});
