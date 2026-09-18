import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  connectTestDb,
  dropAndDisconnect,
  clearCollections,
} from "../../test/dbTestUtils.js";
import { env } from "../../config/env.js";
import User from "../../models/User.js";
import Notification from "../../models/Notification.js";
import { emit } from "./notificationService.js";

// No PushSubscription fixtures are created anywhere in this file — with no
// subscriptions to find, pushService.sendToUser's DB lookup comes back
// empty and it returns immediately, so `emit()` never attempts a real
// network call to a push service here.

let userA, userB, userC;

before(async () => {
  await connectTestDb("notification-service");
});

after(async () => {
  await dropAndDisconnect();
});

beforeEach(async () => {
  await clearCollections(User, Notification);
  const mk = (overrides) =>
    User.create({
      name: "Test User",
      email: `${Math.random().toString(36).slice(2)}@test.local`,
      password: "password123",
      role: "student",
      ...overrides,
    });
  userA = await mk({});
  userB = await mk({});
  userC = await mk({});
});

describe("emit", () => {
  test("creates one Notification per resolved recipient with the rendered template", async () => {
    const result = await emit({
      type: "COURSE_MATERIAL",
      actorId: null,
      entityType: "FILE",
      entityId: new mongoose.Types.ObjectId(),
      vars: {
        actorName: "Prof. Rahim",
        fileName: "Lecture 5.pdf",
        courseName: "DB Systems",
        fileId: "f1",
      },
      recipients: [userA._id, userB._id],
    });
    assert.equal(result.created, 2);

    const docs = await Notification.find({}).sort({ recipient: 1 });
    assert.equal(docs.length, 2);
    assert.equal(docs[0].type, "COURSE_MATERIAL");
    assert.equal(docs[0].title, "New Course Material");
    assert.match(docs[0].message, /Lecture 5\.pdf/);
    assert.equal(docs[0].url, "/files/f1");
    assert.equal(docs[0].isRead, false);
  });

  test("returns { created: 0 } and writes nothing for an empty recipient list", async () => {
    const result = await emit({
      type: "SYSTEM",
      vars: { title: "t", message: "m" },
      recipients: [],
    });
    assert.equal(result.created, 0);
    assert.equal(await Notification.countDocuments(), 0);
  });

  test("never notifies the actor themself, even if they appear in the recipient list", async () => {
    await emit({
      type: "MESSAGE_RECEIVED",
      actorId: userA._id,
      entityType: "MESSAGE",
      entityId: new mongoose.Types.ObjectId(),
      vars: { senderName: "A", preview: "hi", conversationId: "c1" },
      recipients: [userA._id, userB._id],
    });
    const recipients = (await Notification.find({})).map((n) =>
      String(n.recipient),
    );
    assert.deepEqual(recipients, [String(userB._id)]);
  });

  describe("idempotency (spec: a retried request must not double-notify)", () => {
    test("emitting the exact same event twice creates the row only once per recipient", async () => {
      const entityId = new mongoose.Types.ObjectId();
      const event = {
        type: "ASSIGNMENT_RESULT",
        actorId: null,
        entityType: "SUBMISSION",
        entityId,
        vars: { title: "HW1", assignmentId: "a1", marks: 5, maxMarks: 10 },
        recipients: [userA._id],
      };

      const first = await emit(event);
      const second = await emit(event);

      assert.equal(first.created, 1);
      assert.equal(second.created, 0); // the retry inserted nothing new
      assert.equal(
        await Notification.countDocuments({
          recipient: userA._id,
          type: "ASSIGNMENT_RESULT",
        }),
        1,
      );
    });

    test("a genuinely different event (different type) for the same entity is NOT deduped", async () => {
      const entityId = new mongoose.Types.ObjectId();
      await emit({
        type: "EXAM_CREATED",
        entityType: "QUIZ",
        entityId,
        vars: { title: "Midterm", quizId: "q1" },
        recipients: [userA._id],
      });
      await emit({
        type: "EXAM_UPDATED",
        entityType: "QUIZ",
        entityId,
        vars: { title: "Midterm", quizId: "q1" },
        recipients: [userA._id],
      });
      assert.equal(
        await Notification.countDocuments({ recipient: userA._id }),
        2,
      );
    });

    test("two different admin broadcasts (both SYSTEM, no natural entity) never collide with each other", async () => {
      // notificationService generates a fresh entityId per emit() call when
      // none is supplied, specifically so unrelated ad-hoc SYSTEM sends never
      // share an idempotency key and silently clobber each other.
      await emit({
        type: "SYSTEM",
        vars: { title: "First", message: "m1" },
        recipients: [userA._id],
      });
      await emit({
        type: "SYSTEM",
        vars: { title: "Second", message: "m2" },
        recipients: [userA._id],
      });
      assert.equal(
        await Notification.countDocuments({
          recipient: userA._id,
          type: "SYSTEM",
        }),
        2,
      );
    });
  });

  describe("per-type notification preferences", () => {
    test("a user who disabled a type receives no Notification row for it, but still gets other types", async () => {
      userA.notificationPreferences.types.set("COURSE_MATERIAL", false);
      await userA.save();

      await emit({
        type: "COURSE_MATERIAL",
        entityType: "FILE",
        entityId: new mongoose.Types.ObjectId(),
        vars: {
          actorName: "X",
          fileName: "f.pdf",
          courseName: "C",
          fileId: "f1",
        },
        recipients: [userA._id, userB._id],
      });
      const courseMaterialRecipients = (
        await Notification.find({ type: "COURSE_MATERIAL" })
      ).map((n) => String(n.recipient));
      assert.deepEqual(courseMaterialRecipients, [String(userB._id)]);

      await emit({
        type: "NOTICE_CREATED",
        entityType: "NOTICE",
        entityId: new mongoose.Types.ObjectId(),
        vars: { title: "Notice", noticeId: "n1" },
        recipients: [userA._id],
      });
      assert.equal(
        await Notification.countDocuments({
          type: "NOTICE_CREATED",
          recipient: userA._id,
        }),
        1,
      );
    });

    test("SYSTEM notifications are mandatory and ignore per-type preferences entirely", async () => {
      // SYSTEM isn't even a key in notificationPreferences.types (see
      // User.js) — this proves emit() special-cases it rather than relying
      // on the (absent) preference defaulting to true by accident.
      userA.notificationPreferences.types.delete("SYSTEM");
      await userA.save();
      await emit({
        type: "SYSTEM",
        vars: { title: "Down", message: "now" },
        recipients: [userA._id],
      });
      assert.equal(
        await Notification.countDocuments({
          type: "SYSTEM",
          recipient: userA._id,
        }),
        1,
      );
    });

    test("a user missing notificationPreferences.types altogether (pre-existing account) defaults to enabled", async () => {
      // Simulates a document created before this feature existed — Mongoose
      // applies schema defaults on hydration, but this proves the service's
      // own fail-open check holds even if that ever changed.
      await User.collection.updateOne(
        { _id: userC._id },
        { $unset: { notificationPreferences: "" } },
      );
      await emit({
        type: "EXAM_REMINDER",
        entityType: "QUIZ",
        entityId: new mongoose.Types.ObjectId(),
        vars: { title: "Final" },
        recipients: [userC._id],
      });
      assert.equal(
        await Notification.countDocuments({
          type: "EXAM_REMINDER",
          recipient: userC._id,
        }),
        1,
      );
    });
  });

  describe("the email channel", () => {
    // These assert the *attempt* count emit() returns, not delivery: the test
    // harness forces the console transport (see dbTestUtils.js) so a checkout
    // whose .env holds live SMTP credentials never sends real mail here.
    //
    // The channel is OFF by default (NOTIFICATION_EMAIL_ENABLED), so these turn
    // it on for themselves and restore it after.
    beforeEach(() => {
      env.notifications.emailEnabled = true;
    });
    afterEach(() => {
      env.notifications.emailEnabled = false;
    });

    const notice = () => ({
      type: "NOTICE_CREATED",
      entityType: "NOTICE",
      entityId: new mongoose.Types.ObjectId(),
      vars: { title: "Campus closed", noticeId: "n1" },
      recipients: [userA._id],
    });

    test("the master switch off suppresses the email copy, but not the notification", async () => {
      env.notifications.emailEnabled = false;

      const result = await emit(notice());
      assert.equal(result.created, 1, "the in-app row and push are unaffected");
      assert.equal(result.emailed, 0);
    });

    test("emails a copy to a recipient who has the channel enabled", async () => {
      const result = await emit(notice());
      assert.equal(result.created, 1);
      assert.equal(result.emailed, 1, "the email preference defaults to on");
    });

    test("skips a recipient who turned email off", async () => {
      userA.notificationPreferences.email = false;
      await userA.save();

      const result = await emit(notice());
      assert.equal(result.created, 1, "the in-app row is still written");
      assert.equal(result.emailed, 0, "but no mail is sent");
    });

    test("a retried event does not email a second copy", async () => {
      const event = notice();
      const first = await emit(event);
      const second = await emit(event);

      assert.equal(first.emailed, 1);
      assert.equal(second.emailed, 0, "no new row, so nothing to email");
    });

    test("class reminders stay out of email — three per class would be a flood", async () => {
      const result = await emit({
        type: "CLASS_REMINDER",
        entityType: "ScheduleInstance",
        entityId: new mongoose.Types.ObjectId(),
        slot: "30@2026-09-20T04:00:00.000Z",
        vars: { courseCode: "CSE-101", minutesBefore: 30, when: "10:00" },
        recipients: [userA._id],
      });

      assert.equal(result.created, 1, "the in-app reminder is still created");
      assert.equal(result.emailed, 0);
    });
  });
});
