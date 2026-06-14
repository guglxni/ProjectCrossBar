/**
 * Devnet smoke test (standalone, run with tsx to avoid the mocha/Node-26 yargs
 * issue). Proves the DEPLOYED program executes a real instruction on L1
 * (init_market), independent of the Ephemeral Rollup.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=$HOME/.config/solana/id.json \
 *   npx tsx tests/smoke-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint } from "@solana/spl-token";
import * as fs from "fs";

const enc = (s: string) => Buffer.from(s);

async function main() {
  const idl = JSON.parse(fs.readFileSync(__dirname + "/../target/idl/crossbar.json", "utf8"));
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program(idl as anchor.Idl, provider);
  const wallet = provider.wallet as anchor.Wallet;

  const baseMint = await createMint(provider.connection, wallet.payer, wallet.publicKey, null, 6);
  const quoteMint = await createMint(provider.connection, wallet.payer, wallet.publicKey, null, 6);
  console.log("base mint:", baseMint.toBase58());
  console.log("quote mint:", quoteMint.toBase58());

  const market = PublicKey.findProgramAddressSync(
    [enc("market"), baseMint.toBuffer(), quoteMint.toBuffer()], program.programId)[0];
  const seed = (s: string) =>
    PublicKey.findProgramAddressSync([enc(s), market.toBuffer()], program.programId)[0];

  const sig = await program.methods
    .initMarket({
      tickIntervalMs: 50,
      commitEveryTicks: 20,
      bandDeltaBps: 0,
      feeBps: 0,
      maxOrdersPerBatch: 64,
      oracleMaxAgeSlots: 0,
      forceUndelegateTimeoutSlots: 100,
      windowMinTicks: 0, windowMaxTicks: 0, cfmmBase: new BN(0), cfmmQuote: new BN(0), cfmmBandBps: 0, cfmmLevels: 0, lazerFeedId: new BN(0),
      crankAuthority: wallet.publicKey,
    } as any)
    .accountsPartial({
      market,
      batchBook: seed("book"),
      batchResult: seed("result"),
      baseMint,
      quoteMint,
      baseVault: seed("base_vault"),
      quoteVault: seed("quote_vault"),
      oraclePrice: seed("oracle"),
      payer: wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("init_market tx:", sig);
  const m = await (program.account as any).market.fetch(market);
  console.log("Market live on devnet:", market.toBase58());
  console.log("  status:", JSON.stringify(m.status), "tick:", m.tickIntervalMs + "ms", "maxOrders:", m.maxOrdersPerBatch);
  if (m.tickIntervalMs !== 50 || m.maxOrdersPerBatch !== 64 || !m.status.onBase)
    throw new Error("unexpected market state");
  console.log("SMOKE OK: deployed program executed init_market and state reads back correct.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
