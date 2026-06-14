//! Engine CLI for the differential parity test (`tests/parity/run_parity.sh`).
//!
//! Reads a batch on stdin and prints the clearing price + per-order fills in
//! the same format as the verified OCaml oracle (`tests/parity/oracle_cli.ml`),
//! so the two can be diffed against each other.
//!
//! stdin:  N, then N lines `side price qty id` (side 0=buy 1=sell).
//! stdout: `PSTAR <p*>`, then `<id> <filled>` per positive fill.

use std::io::{self, Read};

use crossbar_clearing::{clear_batch, ClearOutcome, ClearingRule, Order};

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).expect("read stdin");
    let mut lines = input.lines();
    let n: usize = lines.next().unwrap().trim().parse().unwrap();

    let mut orders = Vec::with_capacity(n);
    for _ in 0..n {
        let line = lines.next().unwrap();
        let mut it = line.split_whitespace();
        let side: u8 = it.next().unwrap().parse().unwrap();
        let price: u64 = it.next().unwrap().parse().unwrap();
        let qty: u64 = it.next().unwrap().parse().unwrap();
        let id: u64 = it.next().unwrap().parse().unwrap();
        orders.push(if side == 0 {
            Order::buy(id, price, qty)
        } else {
            Order::sell(id, price, qty)
        });
    }

    // Use the dsam-matching rule (UpperBound = marginal buyer price).
    match clear_batch(&orders, ClearingRule::UpperBound) {
        ClearOutcome::Empty => println!("PSTAR 0"),
        ClearOutcome::Cleared { clearing_price, fills, .. } => {
            println!("PSTAR {clearing_price}");
            let mut sorted = fills;
            sorted.sort_by_key(|f| f.order_id);
            for f in sorted {
                if f.filled > 0 {
                    println!("{} {}", f.order_id, f.filled);
                }
            }
        }
    }
}
