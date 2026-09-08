import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, TEMPLATES } from './notificationTemplates.js';
import { NOTIFICATION_TYPES } from '../../models/Notification.js';

describe('renderTemplate', () => {
  test('every NOTIFICATION_TYPES key has a template (extensibility contract)', () => {
    for (const type of NOTIFICATION_TYPES) {
      assert.ok(TEMPLATES[type], `missing template for type "${type}"`);
    }
  });

  test('FILE_UPLOADED substitutes actor/file/course variables', () => {
    const { title, message, url } = renderTemplate('FILE_UPLOADED', {
      actorName: 'Prof. Rahim',
      fileName: 'Lecture 05.pdf',
      courseName: 'Database Systems',
      fileId: 'abc123',
    });
    assert.equal(title, 'New Course Material');
    assert.match(message, /Prof\. Rahim/);
    assert.match(message, /Lecture 05\.pdf/);
    assert.match(message, /Database Systems/);
    assert.equal(url, '/student/materials/abc123');
  });

  test('EXAM_RESULT url points at the attempt-specific result page (never a shared results list)', () => {
    const { url } = renderTemplate('EXAM_RESULT', { title: 'Midterm', attemptId: 'attempt-1' });
    assert.equal(url, '/student/results/attempt-1');
  });

  test('ASSIGNMENT_RESULT includes marks and maxMarks in the message', () => {
    const { message } = renderTemplate('ASSIGNMENT_RESULT', { title: 'HW1', assignmentId: 'a1', marks: 8, maxMarks: 10 });
    assert.match(message, /8\/10/);
  });

  test('MESSAGE_RECEIVED title includes the sender name, url points at the conversation', () => {
    const { title, url } = renderTemplate('MESSAGE_RECEIVED', { senderName: 'Dr. Islam', preview: 'hi', conversationId: 'conv1' });
    assert.match(title, /Dr\. Islam/);
    assert.equal(url, '/messages/conv1');
  });

  test('SYSTEM falls back to caller-supplied title/message/url', () => {
    const { title, message, url } = renderTemplate('SYSTEM', { title: 'Maintenance', message: 'Down for an hour', url: '/status' });
    assert.equal(title, 'Maintenance');
    assert.equal(message, 'Down for an hour');
    assert.equal(url, '/status');
  });

  test('SYSTEM has sane defaults when no vars are supplied', () => {
    const { title, message, url } = renderTemplate('SYSTEM', {});
    assert.equal(title, 'System Notification');
    assert.equal(message, '');
    assert.equal(url, '/notifications');
  });

  test('unknown type throws rather than silently rendering blank', () => {
    assert.throws(() => renderTemplate('NOT_A_REAL_TYPE', {}), /Unknown notification type/);
  });
});
