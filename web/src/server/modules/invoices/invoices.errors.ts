export class InvoiceNotFoundError extends Error {
  constructor() {
    super("Invoice not found.");
    this.name = "InvoiceNotFoundError";
  }
}

export class InvoiceNumberTakenError extends Error {
  constructor() {
    super("You already have an invoice with that number.");
    this.name = "InvoiceNumberTakenError";
  }
}

export class InvoiceClosedError extends Error {
  constructor() {
    super("This invoice is already paid or void.");
    this.name = "InvoiceClosedError";
  }
}

export class InvoiceLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceLockedError";
  }
}
