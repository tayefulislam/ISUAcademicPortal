import { spawn } from 'node:child_process';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { ApiError } from '../../../utils/ApiError.js';

/**
 * Malware scanning hook (§17, "where practical").
 *
 * There is no scanner bundled — shipping one would mean a heavyweight dependency
 * (and, for ClamAV, a persistent daemon with a signature database to keep
 * current) that a deployment may simply not want. Instead this is a single,
 * narrow seam: when `UPLOAD_AV_COMMAND` is configured, the command is run
 * against the file and a non-zero exit is treated as a detection.
 *
 * Because it shells out, the command is taken from the ENVIRONMENT and never
 * from a request — a user-supplied command here would be remote code execution.
 * The file path is passed as a discrete argv element (never interpolated into a
 * shell string), so a filename containing shell metacharacters is inert.
 *
 * The intended configuration, for a host that has ClamAV installed:
 *
 *   UPLOAD_AV_COMMAND=clamdscan --no-summary --fdpass
 *
 * Or, with a plain clamscan and no daemon:
 *
 *   UPLOAD_AV_COMMAND=clamscan --no-summary
 */

/** True when a scanner is configured. */
export function isScanningEnabled() {
  return Boolean(env.uploads.av.command);
}

function splitCommand(command) {
  // Deliberately simple whitespace splitting: the command is operator-set, and
  // quoting rules differ per platform. Anything needing shell quoting should be
  // wrapped in a script on disk instead.
  return String(command).trim().split(/\s+/).filter(Boolean);
}

/**
 * Scans one file on disk.
 *
 * @param {string} filePath an absolute path to the file already spooled to disk
 * @param {{originalName?:string, mimeType?:string}} [meta]
 * @returns {Promise<{clean:boolean, provider:string, skipped:boolean, detail:string}>}
 * @throws {ApiError} 422 when a scanner reports the file as infected
 */
export async function scanFile(filePath, meta = {}) {
  if (!isScanningEnabled()) {
    return { clean: true, provider: 'none', skipped: true, detail: 'no scanner configured' };
  }

  const [bin, ...baseArgs] = splitCommand(env.uploads.av.command);
  if (!bin) {
    return { clean: true, provider: 'none', skipped: true, detail: 'empty scanner command' };
  }

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let child;

    try {
      child = spawn(bin, [...baseArgs, filePath], { windowsHide: true });
    } catch (err) {
      // A missing binary must not make every upload fail — it is a
      // misconfiguration, so fail OPEN with a loud log rather than closed.
      logger.error(err, { source: 'scan.spawn', meta: { bin } });
      resolve({ clean: true, provider: bin, skipped: true, detail: 'scanner could not be started' });
      return;
    }

    child.stdout.on('data', (d) => {
      stdout += d.toString().slice(0, 2000);
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString().slice(0, 2000);
    });

    child.on('error', (err) => {
      logger.error(err, { source: 'scan', meta: { bin } });
      resolve({ clean: true, provider: bin, skipped: true, detail: 'scanner error' });
    });

    child.on('close', (code) => {
      // clamscan/clamdscan exit 0 for clean, 1 for infected, 2 for an error.
      if (code === 0) {
        resolve({ clean: true, provider: bin, skipped: false, detail: 'clean' });
        return;
      }
      if (code === 1) {
        logger.warn(`[uploads] malware detected in ${meta.originalName || filePath}`, { source: 'scan' });
        reject(
          new ApiError(422, 'This file failed a security scan and was rejected', { detail: stdout || stderr }, 'MALWARE_DETECTED')
        );
        return;
      }
      // Exit 2 (or anything else) is a scanner failure, not a detection — fail
      // open so a broken scanner cannot block the whole portal.
      logger.error(new Error(`scanner exited ${code}: ${stderr || stdout}`), { source: 'scan' });
      resolve({ clean: true, provider: bin, skipped: true, detail: `scanner error (exit ${code})` });
    });
  });
}

export default { scanFile, isScanningEnabled };
