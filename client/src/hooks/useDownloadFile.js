import { useCallback } from 'react';
import { fileApi } from '../api/endpoints.js';
import { resolveFileUrl } from '../utils/format.js';
import { trackEvent } from '../utils/analytics.js';

export function useDownloadFile() {
  return useCallback(async (file) => {
    try {
      await fileApi.recordDownload(file._id);
    } catch {
      // metadata counter failure shouldn't block the actual download
    }
    trackEvent('file_download', {
      file_id: file._id,
      file_name: file.title,
      course: file.courseName,
      course_id: file.courseId,
      department: file.departmentCode,
    });

    const url = resolveFileUrl(file.fileUrl);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.originalName || file.title;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, []);
}
