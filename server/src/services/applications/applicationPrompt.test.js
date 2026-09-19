import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerationPrompt, buildSuggestionsPrompt, APPLICATION_SYSTEM_PROMPT } from './applicationPrompt.js';
import { buildEditPrompt, isEditAction, EDIT_ACTIONS } from './aiEditPrompts.js';

// The prompt is where "never invent" is actually enforced, so what it does and
// does not contain is worth asserting.

describe('buildGenerationPrompt', () => {
  const base = {
    applicationTypeName: 'Tuition Fee Reduction',
    recipientRows: [{ label: 'Recipient', value: 'The Registrar' }],
    profileRows: [{ label: 'Name', value: 'Kazi Tayeful Islam' }, { label: 'Student ID', value: '123456' }],
    structuredRows: [{ label: 'Requested Reduction', value: '50%' }],
    subject: 'Application for 50% Tuition Fee Reduction',
    details: 'I am facing financial difficulties.',
    additionalInfo: 'Keep it short.',
  };

  test('carries every provided block through', () => {
    const { user } = buildGenerationPrompt(base);
    for (const expected of [
      'APPLICATION TYPE:', 'Tuition Fee Reduction',
      'RECIPIENT:', 'The Registrar',
      'APPLICANT INFORMATION:', 'Kazi Tayeful Islam', 'Student ID: 123456',
      'SUBJECT:', 'Application for 50% Tuition Fee Reduction',
      'APPLICATION DETAILS:', 'I am facing financial difficulties.',
      'ADDITIONAL INSTRUCTIONS:', 'Keep it short.',
      'STRUCTURED DETAILS:', 'Requested Reduction: 50%',
    ]) {
      assert.ok(user.includes(expected), `missing: ${expected}`);
    }
  });

  test('the system prompt states the never-invent rules', () => {
    for (const rule of [
      'Never invent personal information',
      'Never invent university information',
      'Never invent recipient information',
      'Do not add fake dates, signatures, reference numbers or claims',
      'If information is missing, do not guess it',
      'Never claim that a request has been approved',
    ]) {
      assert.ok(APPLICATION_SYSTEM_PROMPT.includes(rule), `missing rule: ${rule}`);
    }
  });

  test('an empty section says so rather than being omitted', () => {
    const { user } = buildGenerationPrompt({ ...base, recipientRows: [], profileRows: [] });
    assert.ok(user.includes('(none provided)'));
  });

  test('omits a section that was never provided', () => {
    const { user } = buildGenerationPrompt({ ...base, structuredRows: [] });
    assert.ok(!user.includes('STRUCTURED DETAILS:'));
  });
});

describe('AI edit prompts', () => {
  test('every advertised action builds a prompt', () => {
    for (const action of EDIT_ACTIONS) {
      assert.ok(isEditAction(action));
      const prompt = buildEditPrompt({ action, content: 'Original text' });
      assert.ok(prompt && prompt.user.includes('Original text'));
    }
  });

  test('an unknown action is refused rather than guessed', () => {
    assert.equal(isEditAction('delete-everything'), false);
    assert.equal(buildEditPrompt({ action: 'delete-everything', content: 'x' }), null);
  });
});

describe('buildSuggestionsPrompt', () => {
  test('asks for advisory suggestions only', () => {
    const { system, user } = buildSuggestionsPrompt({ content: 'Draft body' });
    assert.ok(user.includes('Draft body'));
    assert.ok(system.includes('informational only'));
    assert.ok(system.includes('do not claim anything was approved'));
  });
});
