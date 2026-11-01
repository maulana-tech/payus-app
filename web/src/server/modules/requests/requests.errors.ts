export class RequestNotFoundError extends Error {
  constructor() {
    super("Request not found.");
    this.name = "RequestNotFoundError";
  }
}

export class RequestRecipientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestRecipientError";
  }
}

export class RequestClosedError extends Error {
  constructor() {
    super("This request is no longer pending.");
    this.name = "RequestClosedError";
  }
}
