import { useCallback, useState } from 'react';
import { uploadApi } from '../api/endpoints.js';

/**
 * The web client's one upload engine.
 *
 * Every surface that uploads a file goes through here, so progress, the
 * per-file outcome, and (for the universal pipeline) the processing status are
 * implemented once rather than re-derived per page. The bytes themselves go
 * through the API (Path A): the multipart path that PUTs straight to the bucket
 * is for a native client, which is not subject to browser CORS.
 *
 * Deliberately NOT responsible for what a file means to a domain — a material, a
 * submission, a notice attachment. The domain endpoint still decides that; this
 * owns only the transfer.
 */
export function useUpload() {
  const [progress, setProgress] = useState(0);
  const [currentName, setCurrentName] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);

  /** Uploads one File to the universal pipeline, reporting byte-level progress. */
  const uploadOne = useCallback(async (file, { purpose, pdfProfile } = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    if (purpose && String(purpose).trim()) fd.append('purpose', String(purpose).trim());
    if (pdfProfile) fd.append('pdfProfile', pdfProfile);

    setProgress(0);
    return uploadApi.create(fd, (evt) => {
      if (evt.total) setProgress(Math.round((evt.loaded * 100) / evt.total));
    });
  }, []);

  /**
   * Uploads files SEQUENTIALLY — one request each — so every file gets an honest,
   * monotonic progress bar instead of a bar that jumps between parallel
   * transfers. Never throws: each file's outcome is returned, so a partial batch
   * is reported accurately and the successful uploads are not lost to one failure.
   *
   * @returns {Promise<Array<{name:string, ok:boolean, record?:object,
   *   duplicates?:object[], warnings?:string[], message?:string}>>}
   */
  const uploadMany = useCallback(
    async (files, options = {}) => {
      const outcomes = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        setCurrentIndex(i);
        setCurrentName(file.name);
        try {
          // eslint-disable-next-line no-await-in-loop
          const res = await uploadOne(file, options);
          outcomes.push({
            name: file.name,
            ok: true,
            record: res.data,
            duplicates: res.duplicates,
            warnings: res.warnings,
          });
        } catch (err) {
          outcomes.push({
            name: file.name,
            ok: false,
            message: err.response?.data?.message || 'Upload failed',
          });
        }
      }
      setCurrentName('');
      setProgress(0);
      return outcomes;
    },
    [uploadOne]
  );

  /**
   * Polls one upload's processing status until it is terminal. Used where a
   * surface wants to follow its own just-uploaded file to "Ready" rather than
   * wait for the listing's next tick.
   */
  const waitForProcessing = useCallback(async (fileId, { intervalMs = 4000, onUpdate } = {}) => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const res = await uploadApi.get(fileId);
      const record = res.data;
      if (onUpdate) onUpdate(record);
      if (record.processingStatus === 'COMPLETED' || record.processingStatus === 'FAILED') return record;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }, []);

  return { progress, currentName, currentIndex, uploadOne, uploadMany, waitForProcessing };
}

export default useUpload;
