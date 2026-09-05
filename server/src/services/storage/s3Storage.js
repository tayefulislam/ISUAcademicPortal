// Placeholder for a future S3-compatible provider (AWS S3, Cloudflare R2,
// DigitalOcean Spaces, etc). Implement uploadDocumentS3/deleteDocumentS3 with
// the same signatures as localStorage.js and wire them into storageService.js
// behind FILE_STORAGE_PROVIDER=s3 — no other module needs to change.

export async function uploadDocumentS3() {
  throw new Error('S3 storage provider is not implemented yet');
}

export async function deleteDocumentS3() {
  throw new Error('S3 storage provider is not implemented yet');
}
