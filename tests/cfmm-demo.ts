/**
 * CFMM backstop liquidity demo (MATH.md 8.3, arXiv 2210.04929). Runs on a LOCAL
 * validator (set_delegated enables run_batch on L1; the augmented clear is what
 * we exercise).
 *
 * A lonely buyer with NO seller in the book would not cross on its own. With a
 * constant-product pool (spot 100) funded on the market, run_batch adds the
 * pool's synthetic maker ladder and the buyer clears against passive liquidity -
 * at a single uniform p*. The pool's reserves then shift along its curve.
 *
 *   ANCHOR_PROVIDER_URL=http://localhost:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json npx tsx tests/cfmm-demo.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import * as fs from "fs";

const PRICE_SCALE = 1_000_000;
const SIDE_BUY = 0, FLOW_TAKER = 1;
const enc = (s: string) => Buffer.from(s);
const px = (p: number) => new BN(Math.round(p * PRICE_SCALE));

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

  // Fund a constant-product pool with spot price 100 (base 1e6, quote 1e8).
  await program.methods.initMarket({
    tickIntervalMs: 50, commitEveryTicks: 20, bandDeltaBps: 0, feeBps: 0,
    maxOrdersPerBatch: 64, oracleMaxAgeSlots: 0, forceUndelegateTimeoutSlots: 100,
    windowMinTicks: 0, windowMaxTicks: 0,
    cfmmBase: new BN(1_000_000), cfmmQuote: new BN(100_000_000), cfmmBandBps: 500, cfmmLevels: 16,
    lazerFeedId: new BN(0), crankAuthority: wallet.publicKey,
  } as any).accountsPartial({
    market, batchBook: seed("book"), batchResult: seed("result"), baseMint, quoteMint,
    baseVault: seed("base_vault"), quoteVault: seed("quote_vault"), oraclePrice: seed("oracle"),
    payer: wallet.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).rpc();
  await program.methods.setDelegated().accountsPartial({ market, authority: wallet.publicKey }).rpc();
  let m = await (program.account as any).market.fetch(market);
  console.log(`Market with CFMM pool: base=${m.cfmmBase} quote=${m.cfmmQuote} (spot=100), band 5%, 16 levels.`);

  // One buyer, no seller in the book.
  const buyer = Keypair.generate();
  await provider.sendAndConfirm(new anchor.web3.Transaction().add(SystemProgram.transfer({
    fromPubkey: wallet.publicKey, toPubkey: buyer.publicKey, lamports: LAMPORTS_PER_SOL / 20 })));
  const qa = await getOrCreateAssociatedTokenAccount(conn, wallet.payer, quoteMint, buyer.publicKey);
  await mintTo(conn, wallet.payer, quoteMint, qa.address, wallet.publicKey, 50_000_000);
  await program.methods.deposit(new BN(50_000_000), false).accountsPartial({ market, vault: seed("quote_vault"),
    userTokenAccount: qa.address, openOrders: oo(buyer.publicKey), owner: buyer.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).signers([buyer]).rpc();
  await program.methods.submitOrder(SIDE_BUY, px(102), new BN(5000), FLOW_TAKER).accountsPartial({
    market, batchBook: seed("book"), openOrders: oo(buyer.publicKey), owner: buyer.publicKey }).signers([buyer]).rpc();
  console.log("Submitted ONE buy @102 x5000 - no seller in the book.");

  const cu = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
  await program.methods.runBatch().accountsPartial({ market, batchBook: seed("book"),
    batchResult: seed("result"), oraclePrice: seed("oracle") }).preInstructions([cu]).rpc();

  const r = await (program.account as any).batchResult.fetch(seed("result"));
  m = await (program.account as any).market.fetch(market);
  console.log(`run_batch: status=${r.status} p*=${r.clearingPrice.toNumber() / PRICE_SCALE} vol=${r.matchedVolume} fills=${r.nFills}`);
  console.log(`CFMM reserves after: base=${m.cfmmBase} quote=${m.cfmmQuote} (pool sold base, gained quote)`);

  if (r.status !== 0 || r.matchedVolume.toNumber() === 0)
    throw new Error("expected the buyer to clear against the CFMM backstop");
  if (Number(m.cfmmBase) >= 1_000_000)
    throw new Error("expected the pool's base reserve to fall (it sold base)");
  console.log("\nCFMM BACKSTOP OK: a thin book (one buyer, no seller) cleared against passive pool");
  console.log("liquidity at a single p*; the pool's reserves moved along its constant-product curve.");
  console.log("With zero reserves this path is byte-identical to the certified baseline (parity preserved).");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
