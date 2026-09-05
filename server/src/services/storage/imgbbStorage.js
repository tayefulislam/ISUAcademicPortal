import { env } from '../../config/env.js';

const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';

/**
 * Upload an image buffer to ImgBB.
 * @returns {{fileUrl:string, storageRef:string}} storageRef is the ImgBB delete_url token.
 */
export async function uploadImageToImgbb(buffer, originalName) {
  if (!env.imgbbApiKey) {
    throw new Error('IMGBB_API_KEY is not configured');
  }

  const form = new FormData();
  form.append('image', new Blob([buffer]), originalName);

  const res = await fetch(`${IMGBB_UPLOAD_URL}?key=${env.imgbbApiKey}`, {
    method: 'POST',
    body: form,
  });

  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json?.error?.message || 'ImgBB upload failed');
  }

  return {
    fileUrl: json.data.url,
    storageRef: json.data.delete_url || '',
  };
}

export async function deleteImageFromImgbb(deleteUrl) {
  if (!deleteUrl) return;
  try {
    await fetch(deleteUrl, { method: 'GET' });
  } catch {
    // ImgBB does not expose a reliable programmatic delete API for free-tier keys;
    // failures here should not block metadata deletion.
  }
}
