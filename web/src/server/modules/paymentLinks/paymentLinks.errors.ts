export class PaymentLinkSlugUnavailableError extends Error {
  constructor() {
    super("You already have a link with that name.");
    this.name = "PaymentLinkSlugUnavailableError";
  }
}

export class PaymentLinkNotFoundError extends Error {
  constructor() {
    super("Payment link not found.");
    this.name = "PaymentLinkNotFoundError";
  }
}
