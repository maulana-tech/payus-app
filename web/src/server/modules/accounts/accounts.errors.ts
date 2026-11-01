export class RecoveryAlreadySetError extends Error {
  constructor() {
    super("This account already has a recovery method.");
    this.name = "RecoveryAlreadySetError";
  }
}

export class EscrowRevisionConflictError extends Error {
  constructor() {
    super("Your PIN changed on another device. Reload and try again.");
    this.name = "EscrowRevisionConflictError";
  }
}

export class EscrowMissingError extends Error {
  constructor() {
    super("This account has no PIN to change.");
    this.name = "EscrowMissingError";
  }
}
