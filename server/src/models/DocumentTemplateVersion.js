import mongoose from 'mongoose';

// The field vocabulary lives in one dependency-free module — so the pure engine
// modules and their tests never have to load Mongoose — and is re-exported here
// so anything working with the model still finds it in the obvious place. The
// web and Android clients render AUTO/STATIC as locked, read-only values and
// USER_INPUT/TEXT/DATE/NUMBER as inputs; the renderer lays the page out from the
// same list, so the three cannot disagree about what a field is.
import { FIELD_TYPES, FIELD_SOURCES, SOURCE_LABELS } from '../services/documents/fieldSources.js';

export { FIELD_TYPES, FIELD_SOURCES, SOURCE_LABELS };

const validationSchema = new mongoose.Schema(
  {
    regex: { type: String, default: '' },
    maxLength: { type: Number, default: 0 },
    min: { type: Number, default: null },
    max: { type: Number, default: null },
  },
  { _id: false }
);

const formattingSchema = new mongoose.Schema(
  {
    dateFormat: { type: String, default: '' },
    uppercase: { type: Boolean, default: false },
    prefix: { type: String, default: '' },
    suffix: { type: String, default: '' },
  },
  { _id: false }
);

const fieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: FIELD_TYPES, default: 'USER_INPUT' },
    // Empty for a field that is not AUTO/STATIC.
    source: { type: String, enum: [...FIELD_SOURCES, ''], default: '' },
    editable: { type: Boolean, default: false },
    required: { type: Boolean, default: false },
    defaultValue: { type: String, default: '' },
    // A STATIC field's fixed text (labels like "Submitted by"). Never resolved
    // from a record, and never editable by a student.
    staticValue: { type: String, default: '' },
    validation: { type: validationSchema, default: () => ({}) },
    formatting: { type: formattingSchema, default: () => ({}) },

    // A4 absolute layout, in millimetres (see templateEngine.js).
    x: { type: Number, default: 20 },
    y: { type: Number, default: 20 },
    width: { type: Number, default: 100 },
    height: { type: Number, default: 8 },
    fontSize: { type: Number, default: 12 },
    fontFamily: { type: String, default: '' },
    bold: { type: Boolean, default: false },
    italic: { type: Boolean, default: false },
    align: { type: String, enum: ['left', 'center', 'right'], default: 'left' },
    color: { type: String, default: '#111111' },

    // Word-like text styling.
    underline: { type: Boolean, default: false },
    strikethrough: { type: Boolean, default: false },
    // Multiple of the font size (Word's "line spacing").
    lineHeight: { type: Number, default: 1.25 },
    // Points, negative tightens (Word's "character spacing").
    letterSpacing: { type: Number, default: 0 },
    // Highlight. Empty means none.
    backgroundColor: { type: String, default: '' },

    // Borders & shading, available on any element (Word's "borders and shading").
    borderWidth: { type: Number, default: 0 },
    borderColor: { type: String, default: '#111111' },
    borderStyle: { type: String, enum: ['none', 'solid', 'dashed', 'dotted'], default: 'solid' },
    borderRadius: { type: Number, default: 0 },

    // An IMAGE element's file name in the server's `img/` folder (e.g. the
    // university logo). A name, never a path or a URL — see services/documents/assets.js.
    asset: { type: String, default: '' },
    // Draw order within the page; a higher number paints on top.
    zIndex: { type: Number, default: 0 },
    // A locked element cannot be dragged or resized on the canvas — the same
    // guard Word's "lock anchor" gives, so a background rule never moves by accident.
    locked: { type: Boolean, default: false },
  },
  { _id: false }
);

// The original design the admin uploaded — a visual reference only. The PDF is
// never attached to the output; the fields above are what get rendered. Stored
// in object storage, key-only here (never the binary, never a public URL).
const sourceFileSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['', 'pdf', 'image'], default: '' },
    s3Key: { type: String, default: '' },
    fileName: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
  },
  { _id: false }
);

const backgroundSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['none', 'image'], default: 'none' },
    s3Key: { type: String, default: '' },
  },
  { _id: false }
);

const styleConfigSchema = new mongoose.Schema(
  {
    fontFamily: { type: String, default: 'Helvetica, Arial, sans-serif' },
    baseFontSize: { type: Number, default: 12 },
    textColor: { type: String, default: '#111111' },
    background: { type: backgroundSchema, default: () => ({}) },
  },
  { _id: false }
);

// An immutable snapshot of a design. A generated document pins
// {template, version}, so a version that has been used must never be rewritten —
// the controller only ever appends a new one (POST /admin/document-templates/:id/versions).
const documentTemplateVersionSchema = new mongoose.Schema(
  {
    template: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentTemplate', required: true },
    version: { type: Number, required: true },
    pageSize: { type: String, default: 'A4' },
    orientation: { type: String, enum: ['portrait', 'landscape'], default: 'portrait' },
    sourceFile: { type: sourceFileSchema, default: () => ({}) },
    fields: { type: [fieldSchema], default: [] },
    styleConfig: { type: styleConfigSchema, default: () => ({}) },
    // Reserved for a future raw-HTML template. Only ever authored by an admin
    // and rendered server-side; a student's input never reaches this string.
    html: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

documentTemplateVersionSchema.index({ template: 1, version: 1 }, { unique: true });

export default mongoose.model('DocumentTemplateVersion', documentTemplateVersionSchema);
