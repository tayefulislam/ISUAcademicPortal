import IORedis from 'ioredis';
import { env } from '../../config/env.js';

/**
 * One Redis connection for BullMQ.
 *
 * <p>Deliberately a factory rather than a shared singleton: a BullMQ Worker
 * needs its own connection (its blocking reads would otherwise stall everything
 * else on the client), and Queue/Worker each own the connections they are given.
 *
 * <p>`maxRetriesPerRequest: null` is required by BullMQ — it manages its own
 * retries and rejects a connection that gives up after N attempts.
 */
export function createRedisConnection() {
  const client = new IORedis(env.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Keep retrying forever, but back off, so a Redis outage degrades to
    // "documents queue until it returns" rather than a hot retry loop.
    retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
  });

  // Without an 'error' listener an ioredis connection failure is an unhandled
  // 'error' event, which takes the whole process down — the API must stay up
  // when Redis is unavailable. Log the first failure only, so a long outage does
  // not flood the log; a later 'ready' re-arms the log.
  client.on('error', (error) => {
    if (client.isuErrorLogged) return;
    client.isuErrorLogged = true;
    console.error(`[documents] redis unavailable at ${describeRedis()} (${error.code || error.message}) — the queue will retry`);
  });
  client.on('ready', () => {
    client.isuErrorLogged = false;
  });

  return client;
}

/** The Redis URL with any credentials masked, for a startup log line. */
export function describeRedis() {
  return String(env.redisUrl).replace(/\/\/[^@/]*@/, '//***@');
}

export default { createRedisConnection, describeRedis };
