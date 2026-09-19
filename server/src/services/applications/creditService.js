import crypto from 'crypto';
import UserCredit from '../../models/UserCredit.js';
import CreditTransaction from '../../models/CreditTransaction.js';
import { ApiError } from '../../utils/ApiError.js';
import { resolveAiConfig } from '../ai/aiConfig.js';

// The credit ledger. Everything the clients show comes from here, and every
// change is an atomic, guarded update — so two clicks (or two devices, or two
// tabs) can never spend the same credit twice, and a failed AI call is refunded.

/** The monthly period containing `now`, starting on `resetDay` (UTC). */
export function periodFor(now, resetDay) {
  // Clamped to 28 so every month has the day.
  const day = Math.min(Math.max(1, Number(resetDay) || 1), 28);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  let start = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  if (start.getTime() > now.getTime()) {
    start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  }
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, day, 0, 0, 0, 0));
  return { start, end };
}

function toSummary(account, config) {
  return {
    creditsEnabled: config.creditsEnabled,
    balance: account?.balance ?? 0,
    monthlyAllocation: account?.monthlyAllocation ?? config.monthlyCredits,
    usedThisPeriod: account?.usedThisPeriod ?? 0,
    periodStart: account?.periodStart || null,
    periodEnd: account?.periodEnd || null,
    nextRechargeAt: account?.nextRechargeAt || null,
    rollover: Boolean(account?.rolloverEnabled),
  };
}

/**
 * Recharges one account if (and only if) its period has actually ended.
 *
 * <p>The compare-and-set on `nextRechargeAt` is what makes this idempotent: the
 * second caller of a doubled job matches nothing and pays nothing.
 */
async function rechargeIfDue(accountId, now, config, period) {
  const { start, end } = period || periodFor(now, config.resetDay);
  const updated = await UserCredit.findOneAndUpdate(
    { _id: accountId, nextRechargeAt: { $lte: now } },
    [
      {
        $set: {
          balance: config.rollover
            ? { $add: ['$balance', config.monthlyCredits] }
            : config.monthlyCredits,
          monthlyAllocation: config.monthlyCredits,
          usedThisPeriod: 0,
          periodStart: start,
          periodEnd: end,
          lastRechargeAt: now,
          nextRechargeAt: end,
        },
      },
    ],
    { new: true }
  );
  if (!updated) return null;

  await CreditTransaction.create({
    user: updated.user,
    type: 'MONTHLY_RECHARGE',
    status: 'CONFIRMED',
    amount: config.monthlyCredits,
    balanceBefore: config.rollover ? updated.balance - config.monthlyCredits : 0,
    balanceAfter: updated.balance,
    description: `Monthly AI credit recharge (${config.monthlyCredits})`,
  });
  return updated;
}

/** The account for a user, created (and, when due, recharged) on first touch. */
export async function ensureAccount(userId) {
  const config = await resolveAiConfig();
  const now = new Date();
  const { start, end } = periodFor(now, config.resetDay);

  let account = await UserCredit.findOne({ user: userId });
  if (!account) {
    account = await UserCredit.create({
      user: userId,
      monthlyAllocation: config.monthlyCredits,
      balance: config.creditsEnabled ? config.monthlyCredits : 0,
      usedThisPeriod: 0,
      periodStart: start,
      periodEnd: end,
      lastRechargeAt: now,
      nextRechargeAt: end,
      rolloverEnabled: config.rollover,
    });
    if (config.creditsEnabled && config.monthlyCredits > 0) {
      await CreditTransaction.create({
        user: userId,
        type: 'MONTHLY_RECHARGE',
        status: 'CONFIRMED',
        amount: config.monthlyCredits,
        balanceBefore: 0,
        balanceAfter: config.monthlyCredits,
        description: 'Initial monthly AI credit allocation',
      });
    }
    return account;
  }

  if (account.nextRechargeAt && account.nextRechargeAt.getTime() <= now.getTime()) {
    const recharged = await rechargeIfDue(account._id, now, config, { start, end });
    if (recharged) account = recharged;
  }
  return account;
}

export async function getSummary(userId) {
  const config = await resolveAiConfig();
  const account = await ensureAccount(userId);
  return toSummary(account, config);
}

export async function getHistory(userId, limit = 50) {
  const rows = await CreditTransaction.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(1, Number(limit) || 50), 200))
    .lean();
  return rows.map((row) => ({
    id: String(row._id),
    type: row.type,
    status: row.status,
    amount: row.amount,
    balanceBefore: row.balanceBefore,
    balanceAfter: row.balanceAfter,
    referenceId: row.referenceId,
    description: row.description,
    createdAt: row.createdAt,
  }));
}

/**
 * Takes `cost` credits, guarded by the balance itself, and returns a reservation.
 *
 * <p>The filter `{ user, balance: { $gte: cost } }` is the lock: when the last
 * credit is available only one of two concurrent calls can match it.
 *
 * @returns {Promise<{reservationId: string|null, skipped: boolean}>}
 */
export async function reserve(userId, cost, { kind = 'AI_GENERATION', description = '' } = {}) {
  const config = await resolveAiConfig();
  if (!config.creditsEnabled || cost <= 0) {
    return { reservationId: null, skipped: true };
  }

  await ensureAccount(userId);

  const charged = await UserCredit.findOneAndUpdate(
    { user: userId, balance: { $gte: cost } },
    { $inc: { balance: -cost, usedThisPeriod: cost } },
    { new: true }
  );

  if (!charged) {
    const current = await UserCredit.findOne({ user: userId }).lean();
    throw new ApiError(
      402,
      'You have used all of your AI application credits for this month.',
      {
        code: 'INSUFFICIENT_AI_CREDITS',
        balance: current?.balance ?? 0,
        nextRechargeAt: current?.nextRechargeAt || null,
      },
      'INSUFFICIENT_AI_CREDITS'
    );
  }

  const reservationId = crypto.randomUUID();
  await CreditTransaction.create({
    user: userId,
    type: kind,
    status: 'PENDING',
    amount: -cost,
    balanceBefore: charged.balance + cost,
    balanceAfter: charged.balance,
    reservationId,
    description: description || 'AI application request',
  });

  return { reservationId, skipped: false };
}

/** Marks a reservation as spent, attaching what it produced. */
export async function finalize(reservationId, referenceId = '') {
  if (!reservationId) return null;
  return CreditTransaction.findOneAndUpdate(
    { reservationId, status: 'PENDING' },
    { $set: { status: 'CONFIRMED', referenceId: String(referenceId || '') } },
    { new: true }
  );
}

/**
 * Gives a reserved credit back — the AI call failed, so the user must not be
 * charged. Idempotent: a second release finds no PENDING reservation.
 */
export async function release(reservationId) {
  if (!reservationId) return null;
  const reservation = await CreditTransaction.findOneAndUpdate(
    { reservationId, status: 'PENDING' },
    { $set: { status: 'RELEASED' } },
    { new: true }
  );
  if (!reservation) return null;

  const refund = Math.abs(reservation.amount);
  await UserCredit.findOneAndUpdate(
    { user: reservation.user },
    [
      {
        $set: {
          balance: { $add: ['$balance', refund] },
          // A recharge may have reset usedThisPeriod in the meantime; never let
          // the refund push it below zero.
          usedThisPeriod: { $max: [0, { $subtract: ['$usedThisPeriod', refund] }] },
        },
      },
    ]
  );
  await CreditTransaction.create({
    user: reservation.user,
    type: 'REFUND',
    status: 'CONFIRMED',
    amount: refund,
    referenceId: String(reservation._id),
    description: 'Refund for a failed AI request',
  });
  return reservation;
}

/** An admin credit change — always audited, never a silent balance edit. */
export async function adjust(actorId, targetUserId, amount, description = '') {
  const delta = Math.trunc(Number(amount) || 0);
  if (!delta) throw new ApiError(400, 'A non-zero adjustment is required');

  const account = await ensureAccount(targetUserId);
  const before = account.balance;
  const updated = await UserCredit.findOneAndUpdate(
    { _id: account._id },
    [{ $set: { balance: { $max: [0, { $add: ['$balance', delta] }] } } }],
    { new: true }
  );

  await CreditTransaction.create({
    user: targetUserId,
    type: 'ADMIN_ADJUSTMENT',
    status: 'CONFIRMED',
    amount: delta,
    balanceBefore: before,
    balanceAfter: updated.balance,
    referenceId: String(actorId || ''),
    description: description || `Admin ${delta > 0 ? 'added' : 'removed'} ${Math.abs(delta)} credit(s)`,
  });

  return toSummary(updated, await resolveAiConfig());
}

/**
 * The monthly sweep: every account whose period has ended is recharged. Safe to
 * run as often as you like — each account is recharged by exactly one caller.
 */
export async function rechargeDueAccounts() {
  const config = await resolveAiConfig();
  if (!config.creditsEnabled) return { recharged: 0 };

  const now = new Date();
  const period = periodFor(now, config.resetDay);
  const due = await UserCredit.find({ nextRechargeAt: { $lte: now } }).select('_id').lean();

  let recharged = 0;
  for (const account of due) {
    // eslint-disable-next-line no-await-in-loop
    const done = await rechargeIfDue(account._id, now, config, period);
    if (done) recharged += 1;
  }
  return { recharged };
}

export default {
  periodFor,
  ensureAccount,
  getSummary,
  getHistory,
  reserve,
  finalize,
  release,
  adjust,
  rechargeDueAccounts,
};
