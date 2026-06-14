#!/usr/bin/env python3
"""Differential parity diff (MATH.md section 6.1, PLAN.md T2.7 layer 2).

Generates batches, runs both the engine CLI and the verified OCaml oracle CLI on
each, and asserts they agree on:
  - the clearing price p*,
  - the total matched volume,
  - per-order fills for every NON-marginal order (orders strictly inside the
    cross). At the marginal price the split may differ legitimately (engine
    rations pro-rata; dsam UM fills sequentially), so only the level total is
    checked there - exactly the rule the uniqueness theorem permits.

Usage: diff_fixtures.py <engine_bin> <oracle_bin>
"""
import subprocess
import sys
import random


def gen_batches():
    """Edge fixtures + deterministic random books."""
    batches = []
    # edges: empty, one-sided, exact cross, no cross, spread, marginal tie
    batches.append([])
    batches.append([(0, 100, 10, 1)])
    batches.append([(0, 100, 10, 1), (1, 100, 10, 2)])
    batches.append([(0, 99, 10, 1), (1, 101, 10, 2)])
    batches.append([(0, 110, 10, 1), (1, 100, 10, 2)])
    batches.append([(0, 105, 10, 1), (0, 100, 10, 2), (1, 100, 15, 3)])
    rng = random.Random(0xC0FFEE)
    for _ in range(4000):
        k = rng.randint(0, 16)
        b = []
        for i in range(k):
            side = rng.randint(0, 1)
            price = rng.randint(95, 106)
            qty = rng.randint(1, 30)
            b.append((side, price, qty, i + 1))
        batches.append(b)
    return batches


def run(binary, batch):
    inp = f"{len(batch)}\n" + "".join(f"{s} {p} {q} {i}\n" for (s, p, q, i) in batch)
    out = subprocess.run(binary, input=inp, capture_output=True, text=True, check=True).stdout
    pstar = 0
    fills = {}
    for line in out.splitlines():
        if line.startswith("PSTAR"):
            pstar = int(line.split()[1])
        elif line.strip():
            oid, f = line.split()
            fills[int(oid)] = int(f)
    return pstar, fills


def main():
    engine_bin, oracle_bin = sys.argv[1], sys.argv[2]
    batches = gen_batches()
    fails = 0
    for n, batch in enumerate(batches):
        ep, ef = run([engine_bin], batch)
        op, of = run([oracle_bin], batch)
        # 1. clearing price
        if ep != op:
            print(f"[FAIL {n}] p* engine={ep} oracle={op} batch={batch}")
            fails += 1
            continue
        # 2. total volume (sum over buys == sum over sells == total; compare buy totals)
        et = sum(f for (s, p, q, i), f in zip(batch, [ef.get(i, 0) for *_, i in batch]))
        # recompute totals robustly from buy side
        ebuy = sum(ef.get(i, 0) for (s, p, q, i) in batch if s == 0)
        obuy = sum(of.get(i, 0) for (s, p, q, i) in batch if s == 0)
        if ebuy != obuy:
            print(f"[FAIL {n}] volume engine={ebuy} oracle={obuy} batch={batch}")
            fails += 1
            continue
        # 3. non-marginal per-order fills. The marginal price differs per side:
        #    the marginal buyer is the LOWEST matched buy price, the marginal
        #    seller is the HIGHEST matched sell price (= p* under UpperBound).
        #    Orders at their side's marginal price may legitimately differ in
        #    the rationed split (pro-rata vs sequential), so only their level
        #    total (already covered by the volume check) is asserted.
        matched = lambda i: ef.get(i, 0) > 0 or of.get(i, 0) > 0
        buy_prices = [p for (s, p, q, i) in batch if s == 0 and matched(i)]
        sell_prices = [p for (s, p, q, i) in batch if s == 1 and matched(i)]
        buy_marg = min(buy_prices) if buy_prices else None
        sell_marg = max(sell_prices) if sell_prices else None
        mismatch = False
        for (s, p, q, i) in batch:
            at_margin = (s == 0 and p == buy_marg) or (s == 1 and p == sell_marg)
            if at_margin:
                continue
            if ef.get(i, 0) != of.get(i, 0):
                print(f"[FAIL {n}] order {i} (s={s} p={p}) engine={ef.get(i,0)} oracle={of.get(i,0)}")
                mismatch = True
        if mismatch:
            fails += 1
    total = len(batches)
    print(f"\nparity: {total - fails}/{total} batches agree (p*, volume, non-marginal fills)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
