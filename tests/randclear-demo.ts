/**
 * Randomized clearing-time mechanism demo (MATH.md 8.1, arXiv 2405.09764).
 * Runs on a LOCAL validator (no ER needed: set_delegated enables run_batch on
 * L1; the window-boundary logic is what we exercise here).
 *
 * Shows that with a window band of N ticks, run_batch ACCUMULATES orders across
 * ticks and only CLOSES the window after the target tick count - so an order's
 * inclusion depends on a close time that (with VRF, on the ER) is unpredictable.
 * The matcher itself is untouched (N1): when the window finally closes, all
 * accumulated orders clear at one p*.
 *
 *   solana-test-validator --reset --quiet &
 *   solana airdrop 100 <WALLET> --url localhost
 *   solana program deploy --program-id target/deploy/crossbar-keypair.json target/deploy/crossbar.so --url localhost
 *   ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json npx tsx tests/randclear-demo.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import * as fs from "fs";

const PRICE_SCALE = 1_000_000;
const SIDE_BUY = 0, SIDE_SELL = 1, FLOW_TAKER = 1, FLOW_MAKER = 0;
const enc = (s: string) => Buffer.from(s);
const px = (p: number) => new BN(Math.round(p * PRICE_SCALE));
const WINDOW_MAX = 3;
const sleep = (ms:number)=>new Promise(r=>setTimeout(r,ms));
const T = Number(process.env.THROTTLE_MS||700); // close after 3 crank ticks (VRF would randomize within [min,max])

async function main() {
  const idl = JSON.parse(fs.readFileSync(__dirname + "/../target/idl/crossbar.json", "utf8"));
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const conn = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;
  const program = new Program(idl as anchor.Idl, provider);
  const PID = program.programId;

  const baseMint = await createMint(conn, wallet.payer, wallet.publicKey, null, 6);
  const quoteMint = await createMint(conn, wallet.payer, wallet.publicKey, null, 6);
  const market = PublicKey.findProgramAddressSync([enc("market"), baseMint.toBuffer(), quoteMint.toBuffer()], PID)[0];
  const seed = (s: string) => PublicKey.findProgramAddressSync([enc(s), market.toBuffer()], PID)[0];
  const oo = (o: PublicKey) => PublicKey.findProgramAddressSync([enc("open_orders"), market.toBuffer(), o.toBuffer()], PID)[0];

  await program.methods.initMarket({
    tickIntervalMs: 50, commitEveryTicks: 20, bandDeltaBps: 0, feeBps: 0,
    maxOrdersPerBatch: 64, oracleMaxAgeSlots: 0, forceUndelegateTimeoutSlots: 100,
    windowMinTicks: 2, windowMaxTicks: WINDOW_MAX, cfmmBase: new BN(0), cfmmQuote: new BN(0), cfmmBandBps: 0, cfmmLevels: 0, lazerFeedId: new BN(0), crankAuthority: wallet.publicKey,
  } as any).accountsPartial({
    market, batchBook: seed("book"), batchResult: seed("result"), baseMint, quoteMint,
    baseVault: seed("base_vault"), quoteVault: seed("quote_vault"), oraclePrice: seed("oracle"),
    payer: wallet.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).rpc();
  await program.methods.setDelegated().accountsPartial({ market, authority: wallet.publicKey }).rpc();
  console.log(`Market initialized with randomized clearing band [2, ${WINDOW_MAX}] ticks. Market:`, market.toBase58());

  async function trader(baseAmt: number, quoteAmt: number) {
    const t = Keypair.generate();
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(SystemProgram.transfer({
      fromPubkey: wallet.publicKey, toPubkey: t.publicKey, lamports: LAMPORTS_PER_SOL / 20 })));
    const ba = await getOrCreateAssociatedTokenAccount(conn, wallet.payer, baseMint, t.publicKey);
    const qa = await getOrCreateAssociatedTokenAccount(conn, wallet.payer, quoteMint, t.publicKey);
    if (baseAmt) { await mintTo(conn, wallet.payer, baseMint, ba.address, wallet.publicKey, baseAmt);
      await program.methods.deposit(new BN(baseAmt), true).accountsPartial({ market, vault: seed("base_vault"),
        userTokenAccount: ba.address, openOrders: oo(t.publicKey), owner: t.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).signers([t]).rpc(); }
    if (quoteAmt) { await mintTo(conn, wallet.payer, quoteMint, qa.address, wallet.publicKey, quoteAmt);
      await program.methods.deposit(new BN(quoteAmt), false).accountsPartial({ market, vault: seed("quote_vault"),
        userTokenAccount: qa.address, openOrders: oo(t.publicKey), owner: t.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).signers([t]).rpc(); }
    return t;
  }
  const submit = (t: Keypair, side: number, p: BN, qty: number, flow: number) =>
    program.methods.submitOrder(side, p, new BN(qty), flow).accountsPartial({ market, batchBook: seed("book"),
      openOrders: oo(t.publicKey), owner: t.publicKey }).signers([t]).rpc().then(()=>sleep(T));
  const tick = async () => {
    await sleep(T);
    const cu = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
    await program.methods.runBatch().accountsPartial({ market, batchBook: seed("book"),
      batchResult: seed("result"), oraclePrice: seed("oracle") }).preInstructions([cu]).rpc();
    return (program.account as any).batchResult.fetch(seed("result"));
  };
  const status = (s: number) => ["Cleared", "SkippedStale", "RejectedBand", "Empty", "Forming"][s] ?? s;

  const buyer = await trader(0, 20_000_000);
  const seller = await trader(1000, 0);

  // Tick 1: buyer submits. Crank fires run_batch -> window FORMING (not closed).
  await submit(buyer, SIDE_BUY, px(101), 100, FLOW_TAKER);
  let r = await tick();
  console.log(`tick 1: status=${status(r.status)}  (buyer's order accumulating; window not closed)`);

  // Tick 2: seller submits into the SAME window. Crank fires -> still FORMING.
  await submit(seller, SIDE_SELL, px(99), 100, FLOW_MAKER);
  r = await tick();
  console.log(`tick 2: status=${status(r.status)}  (both orders now resting in the window)`);

  // Tick 3 = target: window CLOSES, all accumulated orders clear at one p*.
  r = await tick();
  console.log(`tick 3: status=${status(r.status)}  p*=${r.clearingPrice.toNumber() / PRICE_SCALE}  vol=${r.matchedVolume}  fills=${r.nFills}`);

  if (r.status !== 0 || r.matchedVolume.toNumber() !== 100)
    throw new Error("expected the window to close and clear at tick 3");
  console.log("\nRANDOMIZED-CLEARING OK: orders accumulated across ticks; the window closed only at its");
  console.log("target tick and cleared everyone at one p*. With VRF the close tick is unpredictable in [2,3],");
  console.log("so 'submit at the last instant' is no longer a reliable strategy (arXiv 2405.09764).");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
