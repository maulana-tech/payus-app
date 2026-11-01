export class InvalidWebhookUrlError extends Error {
  constructor() {
    super("Use an https:// URL (http://localhost is allowed for testing).");
    this.name = "InvalidWebhookUrlError";
  }
}

export class ApiKeyNotFoundError extends Error {
  constructor() {
    super("API key not found.");
    this.name = "ApiKeyNotFoundError";
  }
}
