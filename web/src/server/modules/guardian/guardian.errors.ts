export class ProposalNotFoundError extends Error {
  constructor(message = "No such proposal.") {
    super(message);
    this.name = "ProposalNotFoundError";
  }
}

export class ProposalRefusedError extends Error {
  constructor(
    message: string,
    readonly findings: unknown,
  ) {
    super(message);
    this.name = "ProposalRefusedError";
  }
}

export class ProposalClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalClosedError";
  }
}

/** The proposal changed after it was approved, so the consent no longer fits. */
export class ApprovalVoidError extends Error {
  constructor(
    message = "This proposal changed after it was approved, so the approval no longer covers it.",
  ) {
    super(message);
    this.name = "ApprovalVoidError";
  }
}
