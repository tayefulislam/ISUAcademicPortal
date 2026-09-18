// Renders the seeded experiment-cover template with sample data — a fast way to
// eyeball the engine without a database, a queue or a logged-in student.
//
//   node scripts/renderTemplateSample.js            # writes document-sample.html
//   node scripts/renderTemplateSample.js --pdf      # also writes document-sample.pdf
//
// The PDF pass needs Playwright's Chromium:
//   npx playwright install chromium
import fs from 'fs/promises';
import path from 'path';
import { renderHtml } from '../src/services/documents/templateEngine.js';
import { buildRenderData } from '../src/services/documents/fieldResolver.js';
import { assetDataUris } from '../src/services/documents/assets.js';
import { experimentCoverFields } from '../src/utils/seedDocumentTemplates.js';

const context = {
  'student.name': 'Kazi Tayeful Islam',
  'student.studentId': '2210000000000001',
  'student.batch': 'BATCH-15',
  'student.group': 'A1',
  'student.department': 'Electrical and Electronic Engineering',
  'department.name': 'Electrical and Electronic Engineering',
  'course.code': 'EEE 2103',
  'course.name': 'Electrical Circuits II',
  'course.department': 'Electrical and Electronic Engineering',
  'faculty.name': 'Dr. Md. Hasanuzzaman',
  'faculty.email': 'hasan@example.edu',
  'university.name': 'International Standard University',
};

const inputData = {
  experiment_no: '07',
  experiment_name: "Verification of Ohm's Law",
  experiment_date: '2026-09-15',
  submission_date: '2026-09-22',
};

const fields = experimentCoverFields();
const { values } = buildRenderData({ fields, context, inputData });
// The logo (and any other image element) is embedded from the server's img/
// folder — the same path the worker takes.
const assets = await assetDataUris(fields);
const version = { pageSize: 'A4', orientation: 'portrait', styleConfig: {}, fields };
const html = renderHtml(version, values, { title: 'ISU Experiment Cover', assets });

const htmlPath = path.resolve(process.cwd(), 'document-sample.html');
await fs.writeFile(htmlPath, html);
console.log(`[sample] wrote ${htmlPath}`);

if (process.argv.includes('--pdf')) {
  const { renderPdf, closePdfBrowser } = await import('../src/services/pdf/pdfService.js');
  const pdf = await renderPdf(html);
  const pdfPath = path.resolve(process.cwd(), 'document-sample.pdf');
  await fs.writeFile(pdfPath, pdf);
  console.log(`[sample] wrote ${pdfPath} (${(pdf.length / 1024).toFixed(1)} KB)`);
  await closePdfBrowser();
}
