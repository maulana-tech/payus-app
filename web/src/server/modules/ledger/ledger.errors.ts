export class LedgerUnbalancedError extends Error {
  constructor(debit: bigint, credit: bigint) {
    super(
      `Ledger transaction is unbalanced: debit ${debit} ≠ credit ${credit}`,
    );
    this.name = "LedgerUnbalancedError";
  }
}

export class LedgerPostingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerPostingError";
  }
}
