import Log from '../models/Log.js';

// Thin wrapper around console.* that also persists a Log document to Mongo —
// fire-and-forget (never awaited, errors swallowed), so a logging failure
// can never break the request that triggered it. `req` is optional context
// (method/url/ip/userId/userAgent) attached automatically when passed.
function persist(level, message, { req, source, stack, statusCode, meta } = {}) {
  Log.create({
    level,
    message: String(message).slice(0, 2000),
    source: source || '',
    stack: stack || '',
    statusCode: statusCode ?? null,
    method: req?.method || '',
    url: req?.originalUrl || '',
    ip: req?.ip || '',
    userId: req?.user?._id || null,
    userAgent: req?.headers?.['user-agent'] || '',
    meta,
  }).catch(() => {
    // Deliberately swallowed — persisting a log must never itself throw.
  });
}

export const logger = {
  info(message, opts = {}) {
    console.log(`[info]${opts.source ? ` [${opts.source}]` : ''} ${message}`);
    persist('info', message, opts);
  },
  warn(message, opts = {}) {
    console.warn(`[warn]${opts.source ? ` [${opts.source}]` : ''} ${message}`);
    persist('warn', message, opts);
  },
  // `err` may be an Error (message/stack extracted) or a plain string.
  error(err, opts = {}) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[error]${opts.source ? ` [${opts.source}]` : ''}`, err);
    persist('error', message, { ...opts, stack });
  },
};
