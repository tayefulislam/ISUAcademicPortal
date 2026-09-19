import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../../test/dbTestUtils.js';
import User from '../../models/User.js';
import UserCredit from '../../models/UserCredit.js';
import CreditTransaction from '../../models/CreditTransaction.js';
import * as credits from './creditService.js';

// The credit ledger against a real database: the guarantees that matter are the
// atomic ones — a last credit can be spent once, a failed generation is
// refunded, and a doubled sweep never pays twice.

const FUTURE = () => new Date(Date.now() + 24 * 60 * 60 * 1000);
const PAST = () => new Date(Date.now() - 60 * 1000);

before(async () => {
  await connectTestDb('ai-credit-flow');
});

after(async () => {
  await dropAndDisconnect();
});

beforeEach(async () => {
  await clearCollections(User, UserCredit, CreditTransaction);
});

async function student(email = 'a@test.local') {
  return User.create({ name: 'A', email, password: 'password123', role: 'student' });
}

async function account(user, balance, { nextRechargeAt = FUTURE(), allocation = 10 } = {}) {
  await UserCredit.create({
    user: user._id,
    monthlyAllocation: allocation,
    balance,
    usedThisPeriod: allocation - balance,
    nextRechargeAt,
  });
}

describe('credit reserve / finalize / release', () => {
  test('a reservation spends a credit, and finalizing keeps it spent', async () => {
    const user = await student();
    await account(user, 10);

    const { reservationId } = await credits.reserve(user._id, 1, { kind: 'AI_GENERATION' });
    assert.ok(reservationId);
    assert.equal((await UserCredit.findOne({ user: user._id })).balance, 9);

    await credits.finalize(reservationId, 'application-1');
    assert.equal((await UserCredit.findOne({ user: user._id })).balance, 9);

    const tx = await CreditTransaction.findOne({ reservationId });
    assert.equal(tx.status, 'CONFIRMED');
    assert.equal(tx.referenceId, 'application-1');
  });

  test('a failed generation refunds the credit', async () => {
    const user = await student();
    await account(user, 10);

    const { reservationId } = await credits.reserve(user._id, 1, { kind: 'AI_GENERATION' });
    await credits.release(reservationId);

    const after = await UserCredit.findOne({ user: user._id });
    assert.equal(after.balance, 10, 'the credit is back');
    assert.equal(after.usedThisPeriod, 0, 'and the usage is undone');
    assert.equal((await CreditTransaction.findOne({ reservationId })).status, 'RELEASED');
    assert.ok(await CreditTransaction.findOne({ type: 'REFUND', user: user._id }));
  });

  test('releasing twice refunds once', async () => {
    const user = await student();
    await account(user, 10);
    const { reservationId } = await credits.reserve(user._id, 1);
    await credits.release(reservationId);
    await credits.release(reservationId);
    assert.equal((await UserCredit.findOne({ user: user._id })).balance, 10);
  });

  test('two simultaneous requests cannot spend the same last credit', async () => {
    const user = await student();
    await account(user, 1);

    const results = await Promise.allSettled([
      credits.reserve(user._id, 1, { kind: 'AI_GENERATION' }),
      credits.reserve(user._id, 1, { kind: 'AI_GENERATION' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    assert.equal(fulfilled.length, 1, 'exactly one request takes the credit');
    const after = await UserCredit.findOne({ user: user._id });
    assert.equal(after.balance, 0);
  });

  test('no balance is refused with a typed, actionable error', async () => {
    const user = await student();
    await account(user, 0);

    await assert.rejects(
      () => credits.reserve(user._id, 1),
      (err) => err.statusCode === 402 && err.code === 'INSUFFICIENT_AI_CREDITS'
    );
  });
});

describe('monthly recharge', () => {
  test('a due account is recharged exactly once, however often the sweep runs', async () => {
    const user = await student();
    await account(user, 3, { nextRechargeAt: PAST(), allocation: 10 });

    const first = await credits.rechargeDueAccounts();
    const second = await credits.rechargeDueAccounts();

    assert.equal(first.recharged, 1);
    assert.equal(second.recharged, 0, 'the second run matches nothing');
    const after = await UserCredit.findOne({ user: user._id });
    // Rollover is off by default: the month starts from the allocation, not 3+10.
    assert.equal(after.balance, 10);
    assert.equal(after.usedThisPeriod, 0);
    assert.ok(after.nextRechargeAt > new Date());
    assert.equal((await CreditTransaction.countDocuments({ type: 'MONTHLY_RECHARGE' })), 1);
  });

  test('an account that is not yet due is left alone', async () => {
    const user = await student();
    await account(user, 4, { nextRechargeAt: FUTURE() });
    const result = await credits.rechargeDueAccounts();
    assert.equal(result.recharged, 0);
    assert.equal((await UserCredit.findOne({ user: user._id })).balance, 4);
  });
});
