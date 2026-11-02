export class PaymentNotFoundError extends Error {
  constructor(message = "No such payment.") {
    super(message);
    this.name = "PaymentNotFoundError";
  }
}

export class InvoiceNotPayableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceNotPayableError";
  }
}
