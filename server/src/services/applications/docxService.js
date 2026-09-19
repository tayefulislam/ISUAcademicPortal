import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import { env } from '../../config/env.js';
import { profileRows } from './profileSnapshot.js';

// A real Word document — headings, paragraphs and a signature block built from
// the docx object model — rather than HTML pasted into a .docx, so the file
// opens as a properly formatted, editable Word letter.

function bodyParagraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 200 },
      children: [new TextRun({ text: block.replace(/\n/g, ' '), size: 24 })],
    }));
}

function line(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 60 },
    alignment: opts.alignment,
    children: [new TextRun({ text, bold: opts.bold, italics: opts.italics, size: opts.size ?? 24 })],
  });
}

function formatDate(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * @param {{ application: object, typeTemplate?: object, universityName?: string, now?: Date }} input
 * @returns {Promise<Buffer>}
 */
export async function buildApplicationDocx({ application, typeTemplate = {}, universityName = '', now = new Date() }) {
  const recipient = application.recipient || {};
  const profile = application.profileSnapshot || {};
  const letterhead = recipient.letterhead || {};

  const header = typeTemplate.headerOverride
    || letterhead.universityName
    || universityName
    || env.universityName
    || '';

  const children = [];

  if (header) {
    children.push(line(header, { bold: true, size: 30, alignment: AlignmentType.CENTER, after: 60 }));
  }
  if (letterhead.addressLine) {
    children.push(line(letterhead.addressLine, { size: 20, alignment: AlignmentType.CENTER, after: 240 }));
  }
  if (header || letterhead.addressLine) {
    children.push(new Paragraph({ spacing: { after: 240 } }));
  }

  children.push(line(`Date: ${formatDate(now)}`, { after: 240 }));

  if (recipient.name || recipient.office || recipient.address) {
    children.push(line('To', { after: 60 }));
    for (const value of [recipient.name, recipient.designation, recipient.office, recipient.address]) {
      if (value && String(value).trim()) children.push(line(String(value).trim(), { after: 40 }));
    }
    children.push(new Paragraph({ spacing: { after: 200 } }));
  }

  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [
      new TextRun({ text: 'Subject: ', bold: true, size: 24 }),
      new TextRun({ text: application.subject || '', bold: true, size: 24 }),
    ],
  }));

  children.push(line(typeTemplate.salutation || 'Dear Sir/Madam,', { after: 200 }));

  children.push(...bodyParagraphs(application.editedContent));

  children.push(line(typeTemplate.closing || 'I shall be grateful for your kind consideration.', { after: 400 }));

  children.push(line('Yours faithfully,', { after: 400 }));
  for (const row of profileRows(profile)) {
    children.push(line(`${row.label}: ${row.value}`, { after: 40 }));
  }

  const footer = typeTemplate.footerOverride || letterhead.footer || '';
  if (footer) {
    children.push(new Paragraph({
      spacing: { before: 400 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: footer, size: 18, color: '666666' })],
    }));
  }

  const document = new Document({
    creator: 'ISU Academic Portal',
    title: application.subject || 'Application',
    sections: [
      {
        properties: { page: { margin: { top: 1247, bottom: 1247, left: 1134, right: 1134 } } },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}

export default { buildApplicationDocx };
