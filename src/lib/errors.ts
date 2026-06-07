// Base class for all external service integration errors.
// Each service extends this with its own class (HubSpotError, GoogleError, etc.)
export class IntegrationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'IntegrationError'
  }
}

export class HubSpotError extends IntegrationError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string
  ) {
    super(message)
    this.name = 'HubSpotError'
  }
}

// Scaffold error classes — extend these when implementing the actual clients.
// Defined here so error taxonomy exists before implementation is wired up.

export class GoogleError extends IntegrationError {
  constructor(message: string, public readonly status?: number, cause?: unknown) {
    super(message, cause)
    this.name = 'GoogleError'
  }
}

export class SkipTracingError extends IntegrationError {
  constructor(message: string, public readonly status?: number, cause?: unknown) {
    super(message, cause)
    this.name = 'SkipTracingError'
  }
}

export class JustCallError extends IntegrationError {
  constructor(message: string, public readonly status?: number, cause?: unknown) {
    super(message, cause)
    this.name = 'JustCallError'
  }
}

export class BrowserError extends IntegrationError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'BrowserError'
  }
}
