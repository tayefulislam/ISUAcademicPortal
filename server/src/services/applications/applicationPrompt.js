// Builds the AI request from structured data. Pure on purpose: every input is a
// string or a small array, so the prompt's guarantees ("never invent …") are
// unit-testable without a database or a provider.

export const APPLICATION_SYSTEM_PROMPT = [
  'You are a professional university application writing assistant.',
  '',
  'Generate a formal, respectful and professional university application.',
  '',
  'IMPORTANT RULES:',
  '- Use only the information provided.',
  '- Never invent personal information.',
  '- Never invent university information.',
  '- Never invent recipient information.',
  "- Do not change the applicant's name, ID, department, batch or other verified information.",
  '- Use appropriate formal university language.',
  '- Keep the application clear and concise.',
  '- Follow the selected application type.',
  '- Address the selected recipient correctly.',
  '- Do not add fake dates, signatures, reference numbers or claims.',
  '- If information is missing, do not guess it.',
  '- Never claim that a request has been approved, and never claim that supporting documents exist unless they were stated.',
  '',
  'Return ONLY the body of the application — the paragraphs between the salutation and the closing.',
  'Do not include a date, the recipient block, the subject line, the salutation, or the signature block; the portal adds those.',
].join('\n');

function rowsToText(rows) {
  if (!rows || !rows.length) return '';
  return rows
    .map((row) => `${row.label}: ${row.value}`)
    .filter((line) => !line.endsWith(': '))
    .join('\n');
}

/**
 * @param {{
 *   applicationTypeName?: string,
 *   recipientRows?: Array<{label:string,value:string}>,
 *   profileRows?: Array<{label:string,value:string}>,
 *   structuredRows?: Array<{label:string,value:string}>,
 *   subject?: string, details?: string, additionalInfo?: string,
 *   typeInstructions?: string,
 * }} input
 * @returns {{system: string, user: string}}
 */
export function buildGenerationPrompt({
  applicationTypeName = '',
  recipientRows = [],
  profileRows = [],
  structuredRows = [],
  subject = '',
  details = '',
  additionalInfo = '',
  typeInstructions = '',
} = {}) {
  const user = [
    'APPLICATION TYPE:',
    applicationTypeName,
    '',
    'RECIPIENT:',
    rowsToText(recipientRows) || '(none provided)',
    '',
    'APPLICANT INFORMATION:',
    rowsToText(profileRows) || '(none provided)',
    '',
    'SUBJECT:',
    subject,
    '',
    'APPLICATION DETAILS:',
    details,
    '',
    'ADDITIONAL INSTRUCTIONS:',
    additionalInfo || typeInstructions || '(none)',
  ];

  const structured = rowsToText(structuredRows);
  if (structured) {
    user.push('', 'STRUCTURED DETAILS:', structured);
  }
  user.push('', 'Generate the complete application body.');

  return { system: APPLICATION_SYSTEM_PROMPT, user: user.join('\n') };
}

/** The AI suggestions request — advisory only, never a source of new facts. */
export function buildSuggestionsPrompt({ content }) {
  const system = [
    'You are a university application reviewer.',
    'Given a drafted application, list at most 4 short, practical suggestions for the applicant.',
    'Each suggestion is one sentence and informational only — do NOT add facts, do not rewrite the application, and do not claim anything was approved.',
    'Return one suggestion per line, with no numbering, bullets, or preamble.',
  ].join('\n');
  const user = `APPLICATION DRAFT:\n\n---\n${content}\n---\n\nList your suggestions.`;
  return { system, user };
}

export default { APPLICATION_SYSTEM_PROMPT, buildGenerationPrompt, buildSuggestionsPrompt };
