// The quick "AI editing" actions offered beside the editor. Each is a rewrite
// of the CURRENT text with a single instruction, and the same never-invent rule
// as generation.

export const EDIT_ACTIONS = ['formal', 'shorter', 'detailed', 'grammar', 'rewrite', 'respectful', 'trim'];

export const EDIT_ACTION_LABELS = {
  formal: 'Make More Formal',
  shorter: 'Make Shorter',
  detailed: 'Make More Detailed',
  grammar: 'Improve Grammar',
  rewrite: 'Rewrite',
  respectful: 'Add Respectful Tone',
  trim: 'Remove Unnecessary Text',
};

const INSTRUCTIONS = {
  formal: 'Rewrite the application in a more formal, official tone.',
  shorter: 'Make the application significantly shorter while keeping every essential fact.',
  detailed: 'Expand the application with more detail, using only the facts already present in the text.',
  grammar: 'Correct any grammar, spelling and punctuation errors. Change nothing else.',
  rewrite: 'Rewrite the application in fresh wording, with the same meaning and the same facts.',
  respectful: 'Add a respectful, courteous tone throughout.',
  trim: 'Remove unnecessary or repetitive text. Keep every essential fact.',
};

export function isEditAction(action) {
  return Object.prototype.hasOwnProperty.call(INSTRUCTIONS, action);
}

const SYSTEM = [
  'You are a professional university application editor.',
  'You revise the text you are given and nothing else.',
  '',
  'IMPORTANT RULES:',
  '- Use only the facts already present in the text.',
  '- Never invent personal, university or recipient information.',
  '- Never add a date, signature, reference number, or a claim that anything was approved.',
  '- Return ONLY the revised application body: no date, no recipient block, no subject line, no salutation, no signature block, and no commentary.',
].join('\n');

/**
 * @param {{action: string, content: string}} args
 * @returns {{system: string, user: string}|null} null for an unknown action
 */
export function buildEditPrompt({ action, content }) {
  const instruction = INSTRUCTIONS[action];
  if (!instruction) return null;
  const user = [
    'Here is the current application:',
    '',
    '---',
    content,
    '---',
    '',
    `TASK: ${instruction}`,
    '',
    'Return only the revised application body.',
  ].join('\n');
  return { system: SYSTEM, user };
}

export default { EDIT_ACTIONS, EDIT_ACTION_LABELS, isEditAction, buildEditPrompt };
