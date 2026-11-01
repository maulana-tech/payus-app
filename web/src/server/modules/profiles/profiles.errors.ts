export class InvalidClaimError extends Error {
  constructor(reason: string) {
    super(`Profile claim rejected: ${reason}`);
    this.name = "InvalidClaimError";
  }
}

export class UsernameTakenError extends Error {
  constructor() {
    super("That username is taken.");
    this.name = "UsernameTakenError";
  }
}

export class ProfileExistsError extends Error {
  constructor() {
    super("This account already has a username.");
    this.name = "ProfileExistsError";
  }
}
