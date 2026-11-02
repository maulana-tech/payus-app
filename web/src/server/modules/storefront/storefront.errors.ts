export class StorefrontNotFoundError extends Error {
  constructor(message = "No such storefront.") {
    super(message);
    this.name = "StorefrontNotFoundError";
  }
}

export class SlugTakenError extends Error {
  constructor(message = "That address is already in use.") {
    super(message);
    this.name = "SlugTakenError";
  }
}
