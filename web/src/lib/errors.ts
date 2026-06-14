const ERROR_MESSAGES: Record<string, string> = {
  BatchFull:
    "The forming batch window already has the maximum number of orders.",
  WindowClosed:
    "This order's batch window has closed. Cancel is only allowed while the window is still forming.",
  OutOfBand:
    "The clearing price would fall outside the oracle reference band. The tick was rejected.",
  StaleOracle:
    "The oracle feed is older than the configured max age. This tick was skipped.",
  NotCrankAuthority:
    "Only the configured crank authority can run this instruction.",
  WrongStatus:
    "The market is not in the expected lifecycle status for this action.",
  VrfTimeout:
    "VRF did not return in time. The program fell back to a deterministic tie-break.",
  MarketMismatch: "One of the accounts does not belong to this market.",
  Overflow: "An arithmetic overflow occurred.",
  OrderNotFound: "Order not found in the forming window.",
  InsufficientFunds:
    "Insufficient deposited balance to escrow this order. Deposit more tokens first.",
  InvalidPermissionProgram:
    "The permission program account is not the canonical MagicBlock permission program.",
  AlreadySettled:
    "This trader has already been settled for this batch window.",
  FillExceedsReserved:
    "Filled quantity exceeds reserved escrow. This indicates a matcher or escrow desync.",
  OracleDeviation:
    "Reference price update is zero or deviates too far from the previous price.",
};

export function crossbarErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? `Program error: ${code}`;
}

export function parseProgramError(err: unknown): string {
  const text = String(err);
  for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
    if (text.includes(code)) return message;
  }
  if (text.includes("User rejected")) return "Transaction was rejected in the wallet.";
  if (text.includes("blockhash")) return "Transaction expired. Try again.";
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}
