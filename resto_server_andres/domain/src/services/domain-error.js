export class DomainError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'DomainError';
    this.statusCode = statusCode;
  }
}
