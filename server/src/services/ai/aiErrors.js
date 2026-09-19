// A failure the AI layer can describe to a caller without leaking provider
// detail. Everything that reaches a user is mapped from one of these codes to a
// friendly sentence; the raw provider error is only ever logged.

export const AI_ERROR = Object.freeze({
  NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  UNAVAILABLE: 'AI_UNAVAILABLE',
  TIMEOUT: 'AI_TIMEOUT',
  RATE_LIMITED: 'AI_RATE_LIMITED',
  EMPTY_RESPONSE: 'AI_EMPTY_RESPONSE',
});

export class AiError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'AiError';
    this.code = code;
    // 503 for "not available right now", 504 for a timeout — the client shows a
    // retry message either way.
    this.statusCode = code === AI_ERROR.TIMEOUT ? 504 : 503;
  }
}

export default { AI_ERROR, AiError };
