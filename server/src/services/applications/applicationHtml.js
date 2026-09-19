import { env } from '../../config/env.js';
import { escapeHtml } from '../documents/sanitize.js';
import { signatureRows } from './profileSnapshot.js';

// The formal letter, as the HTML the PDF renderer prints. Every interpolated
// value is escaped, and the wording comes from the configured recipient/type —
// never from the AI — so a model cannot invent a letterhead or a designation.

function formatDate(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function paragraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+$/g, '').trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n      ');
}

/**
 * @param {{
 *   application: object, typeTemplate?: object, universityName?: string, now?: Date,
 * }} input
 * @returns {string} a complete A4 HTML document
 */
export function buildApplicationHtml({ application, typeTemplate = {}, universityName = '', now = new Date() }) {
  const recipient = application.recipient || {};
  const profile = application.profileSnapshot || {};
  const letterhead = recipient.letterhead || {};

  const header = typeTemplate.headerOverride
    || letterhead.universityName
    || universityName
    || env.universityName
    || '';

  const toLines = [recipient.name, recipient.designation, recipient.office, recipient.address]
    .filter((line) => line && String(line).trim())
    .map((line) => escapeHtml(String(line).trim()))
    .join('<br>');

  // The letter signs off with the applicant's identity only — never a section,
  // email or phone number (see signatureRows).
  const signature = signatureRows(profile)
    .map((row) => `${escapeHtml(row.label)}: ${escapeHtml(row.value)}`)
    .join('<br>');

  const salutation = typeTemplate.salutation || 'Dear Sir/Madam,';
  const closing = typeTemplate.closing || 'I shall be grateful for your kind consideration.';
  const footer = typeTemplate.footerOverride || letterhead.footer || '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(application.subject || 'Application')}</title>
  <style>
    @page { size: A4; margin: 22mm 20mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Times New Roman", Times, Georgia, serif;
      font-size: 12pt;
      line-height: 1.5;
      color: #111111;
    }
    .letterhead { text-align: center; font-weight: 700; font-size: 15pt; letter-spacing: 0.3px; }
    .letterhead-address { text-align: center; font-size: 10pt; color: #444; margin-top: 2px; }
    .rule { border-top: 1px solid #111; margin: 10px 0 18px; }
    .date { margin-bottom: 16px; }
    .to { margin-bottom: 16px; }
    .subject { font-weight: 700; margin-bottom: 16px; }
    .salutation { margin-bottom: 10px; }
    p { margin: 0 0 10px; text-align: justify; }
    .closing { margin-top: 18px; }
    .signature { margin-top: 46px; }
    .signature .name { font-weight: 700; }
    .signature-lines { margin-top: 4px; font-size: 11pt; line-height: 1.5; }
    .footer { margin-top: 28px; border-top: 1px solid #ccc; padding-top: 6px; font-size: 9pt; color: #555; text-align: center; }
  </style>
</head>
<body>
  ${header ? `<div class="letterhead">${escapeHtml(header)}</div>` : ''}
  ${letterhead.addressLine ? `<div class="letterhead-address">${escapeHtml(letterhead.addressLine)}</div>` : ''}
  ${header || letterhead.addressLine ? '<div class="rule"></div>' : ''}

  <div class="date">Date: ${escapeHtml(formatDate(now))}</div>

  ${toLines ? `<div class="to">To<br>${toLines}</div>` : ''}

  <div class="subject">Subject: ${escapeHtml(application.subject || '')}</div>

  <div class="salutation">${escapeHtml(salutation)}</div>

  <div class="body">
      ${paragraphs(application.editedContent)}
  </div>

  <p class="closing">${escapeHtml(closing)}</p>

  <div class="signature">
    <div>Yours faithfully,</div>
    <div class="signature-lines">${signature}</div>
  </div>

  ${footer ? `<div class="footer">${escapeHtml(footer)}</div>` : ''}
</body>
</html>`;
}

export default { buildApplicationHtml };
