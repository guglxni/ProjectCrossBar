(* Oracle CLI for the differential parity test (MATH.md section 6.1).
 *
 * Wraps the verified, extracted uniform matcher `UM` from
 * vendor/dsam/Demonstration/certified.ml (committed by the TIFR authors from
 * their Coq development). Reads a batch on stdin and prints the clearing price
 * and per-order filled quantities, so the engine's output can be diffed
 * against it.
 *
 * Compile (see run_parity.sh):
 *   ocamlfind ocamlopt vendor/dsam/Demonstration/certified.ml \
 *     tests/parity/oracle_cli.ml -o tests/parity/oracle
 * (certified.ml becomes module `Certified`.)
 *
 * stdin format:
 *   N
 *   side price qty id      (N lines; side 0=buy 1=sell; integers)
 * stdout format:
 *   PSTAR <p*>             (0 if no cross)
 *   <id> <filled>          (one line per order with positive fill)
 *)

let () =
  let n = int_of_string (String.trim (input_line stdin)) in
  let bids = ref [] and asks = ref [] in
  for _ = 1 to n do
    match String.split_on_char ' ' (String.trim (input_line stdin)) with
    | [side; price; qty; id] ->
      let side = int_of_string side and price = int_of_string price
      and qty = int_of_string qty and id = int_of_string id in
      if side = 0 then
        bids := { Certified.bp = price; btime = id; bq = qty; idb = id } :: !bids
      else
        asks := { Certified.sp = price; stime = id; sq = qty; ida = id } :: !asks
    | _ -> failwith "bad fixture line"
  done;
  let fills = Certified.uM !bids !asks in
  (* p* is the traded price stamped on every fill (the uniform price). *)
  let pstar = match fills with [] -> 0 | f :: _ -> f.Certified.tp in
  Printf.printf "PSTAR %d\n" pstar;
  (* Aggregate traded quantity per order id, both sides. *)
  let tbl = Hashtbl.create 64 in
  List.iter
    (fun (f : Certified.fill_type) ->
      let add id =
        let prev = try Hashtbl.find tbl id with Not_found -> 0 in
        Hashtbl.replace tbl id (prev + f.Certified.tq)
      in
      add f.Certified.bid_of.idb;
      add f.Certified.ask_of.ida)
    fills;
  (* Deterministic output order. *)
  let ids = Hashtbl.fold (fun k _ acc -> k :: acc) tbl [] in
  List.iter
    (fun id ->
      let q = Hashtbl.find tbl id in
      if q > 0 then Printf.printf "%d %d\n" id q)
    (List.sort compare ids)
