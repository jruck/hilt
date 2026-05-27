export class LibrarySourceBlockedError extends Error {
  constructor(
    message: string,
    public readonly sourceId: string,
  ) {
    super(message);
    this.name = "LibrarySourceBlockedError";
  }
}

export class MissingCredentialError extends LibrarySourceBlockedError {
  constructor(sourceId: string, envName: string) {
    super(`Missing required credential: ${envName}`, sourceId);
    this.name = "MissingCredentialError";
  }
}

export function isLibrarySourceBlockedError(error: unknown): error is LibrarySourceBlockedError {
  return error instanceof LibrarySourceBlockedError;
}

