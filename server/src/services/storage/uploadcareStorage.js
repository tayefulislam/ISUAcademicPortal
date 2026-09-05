import { env } from "../../config/env.js";

const UPLOADCARE_API = "https://api.uploadcare.com";

export function uploadcareCdnUrl(uuid) {
  return `https://4nkh05qlro.ucarecd.net/${uuid}/`;
}

/**
 * Files reach Uploadcare directly from the browser (their widget uploads
 * straight to Uploadcare's CDN, bypassing our server entirely) — so there is
 * no server-side upload function here. This module only handles cleanup:
 * removing the file from Uploadcare's storage when its File entry is deleted.
 */
export async function deleteFromUploadcare(uuid) {
  if (!uuid || !env.uploadcareSecretKey) return;

  try {
    await fetch(`${UPLOADCARE_API}/files/${uuid}/storage/`, {
      method: "DELETE",
      headers: {
        Authorization: `Uploadcare.Simple ${env.uploadcarePublicKey}:${env.uploadcareSecretKey}`,
        Accept: "application/vnd.uploadcare-v0.7+json",
      },
    });
  } catch {
    // best-effort — an orphaned Uploadcare asset is not worth failing the
    // metadata deletion over
  }
}
