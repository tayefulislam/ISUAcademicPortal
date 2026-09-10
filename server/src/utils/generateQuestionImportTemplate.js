// One-off generator for the example .docx handed to admins/faculty from the
// "Import from DOCX" modal (client/src/pages/shared/QuestionBank.jsx) —
// covers every question type the parser (docxQuestionParser.js) supports, so
// downloading it and re-uploading it unmodified proves the whole pipeline.
// Run with: npm run generate:question-template (writes into client/public/
// so Vite serves it as a static download at /templates/... in dev and prod).
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../../../client/public/templates');
const OUT_FILE = path.join(OUT_DIR, 'question-import-example.docx');

const p = (text) => new Paragraph({ children: [new TextRun(text)] });
const blank = () => new Paragraph({ children: [new TextRun('')] });

const paragraphs = [
  new Paragraph({ children: [new TextRun({ text: 'Question Bank — DOCX Import Example', bold: true, size: 32 })] }),
  p('One question per "Q<number>." block. Lines below it are read until the next "Q<number>." line.'),
  p('Options: "A) text" (add a trailing * to mark it correct). Type: is optional where it can be inferred.'),
  blank(),

  p('Q1. What is the capital of France?'),
  p('A) London'),
  p('B) Paris *'),
  p('C) Rome'),
  p('D) Berlin'),
  p('Explanation: Paris has been the capital of France since 508 AD.'),
  p('Marks: 2'),
  p('Difficulty: easy'),
  p('Tags: geography, capitals'),
  blank(),

  p('Q2. The Great Wall of China is visible from space with the naked eye.'),
  p('Type: true_false'),
  p('A) True'),
  p('B) False *'),
  p('Explanation: This is a common myth — it is not actually visible without aid.'),
  blank(),

  p('Q3. Which of the following are prime numbers?'),
  p('Type: multi_select'),
  p('A) 2 *'),
  p('B) 4'),
  p('C) 7 *'),
  p('D) 9'),
  p('E) 11 *'),
  p('Marks: 3'),
  blank(),

  p('Q4. The chemical symbol for water is ___.'),
  p('Type: fill_blank'),
  p('Answer: H2O'),
  blank(),

  p('Q5. Who wrote the play "Romeo and Juliet"?'),
  p('Type: short_answer'),
  p('Answer: William Shakespeare; Shakespeare'),
  blank(),

  p('Q6. What is 12 multiplied by 8?'),
  p('Type: numerical'),
  p('Answer: 96'),
  p('Tolerance: 0'),
  blank(),

  p('Q7. Explain the causes of World War I in your own words.'),
  p('Type: long_answer'),
  p('Marks: 5'),
  blank(),

  p('Q8. Match the scientist to their discovery.'),
  p('Type: matching'),
  p('Left: Newton | Right: Gravity'),
  p('Left: Einstein | Right: Relativity'),
  p('Left: Darwin | Right: Evolution'),
];

const doc = new Document({ sections: [{ children: paragraphs }] });

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const buffer = await Packer.toBuffer(doc);
  await writeFile(OUT_FILE, buffer);
  console.log(`Wrote ${OUT_FILE} (${buffer.length} bytes)`);
}

main();
