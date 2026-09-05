const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const EXT_MAP = {
  pdf: { fileType: 'pdf', mime: ['application/pdf'], dir: 'pdf' },
  doc: { fileType: 'doc', mime: ['application/msword'], dir: 'documents' },
  docx: {
    fileType: 'docx',
    mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    dir: 'documents',
  },
  ppt: { fileType: 'ppt', mime: ['application/vnd.ms-powerpoint'], dir: 'presentations' },
  pptx: {
    fileType: 'pptx',
    mime: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    dir: 'presentations',
  },
  xls: { fileType: 'xls', mime: ['application/vnd.ms-excel'], dir: 'spreadsheets' },
  xlsx: {
    fileType: 'xlsx',
    mime: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    dir: 'spreadsheets',
  },
  txt: { fileType: 'txt', mime: ['text/plain'], dir: 'other' },
  zip: { fileType: 'zip', mime: ['application/zip', 'application/x-zip-compressed'], dir: 'other' },
};

const ALL_DOC_MIME = new Set(Object.values(EXT_MAP).flatMap((e) => e.mime));

export function isImageMime(mime) {
  return IMAGE_MIME.has(mime);
}

export function isAllowedDocumentMime(mime) {
  return ALL_DOC_MIME.has(mime);
}

export function isAllowedUploadMime(mime) {
  return isImageMime(mime) || isAllowedDocumentMime(mime);
}

export function resolveDocumentType(mime, originalName) {
  const byMime = Object.values(EXT_MAP).find((e) => e.mime.includes(mime));
  if (byMime) return byMime;

  const ext = (originalName.split('.').pop() || '').toLowerCase();
  if (EXT_MAP[ext]) return EXT_MAP[ext];

  return { fileType: 'other', mime: [mime], dir: 'other' };
}

export function getSafeExtension(originalName) {
  const ext = (originalName.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return ext || 'bin';
}
