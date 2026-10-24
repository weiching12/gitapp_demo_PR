// Application failures carry a stable code, independent of HTTP or storage.
export class DomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
