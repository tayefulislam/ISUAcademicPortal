import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateZipStructure, validateDocumentPackage } from './officeValidator.js';
import { validateArchive, mustStoreOriginal, NEVER_MODIFY_EXTS } from './archiveGuard.js';

/**
 * Fixtures are built byte-by-byte rather than with a zip library, so the test
 * does not depend on the thing it is testing — and so a "corrupt" case can be
 * corrupted deliberately rather than hoped for.
 */

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** A minimal, spec-correct zip (stored, no compression). */
function buildZip(entries, { breakEocd = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data || '');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(Buffer.concat([local, name, data]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));

    offset += locals[locals.length - 1].length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(breakEocd ? 0x12345678 : 0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, cd, eocd]);
}

/** A POSIX tar block with a correct checksum. */
function buildTar(name, { corrupt = false } = {}) {
  const block = Buffer.alloc(512);
  block.write(name, 0, 'latin1');
  block.write('0000644', 100, 'latin1');
  block.write('0000000', 108, 'latin1');
  block.write('0000000', 116, 'latin1');
  block.write('00000000000', 124, 'latin1');
  block.write('00000000000', 136, 'latin1');
  block.write('        ', 148, 'latin1'); // checksum field as spaces while summing
  block.write('0', 156, 'latin1');
  block.write('ustar\0', 257, 'latin1');
  block.write('00', 263, 'latin1');

  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');

  if (corrupt) block[0] = block[0] === 0x61 ? 0x62 : 0x61; // break the name, not the checksum
  return block;
}

async function writeTemp(name, buffer) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'isu-zip-'));
  const file = path.join(dir, name);
  await fs.writeFile(file, buffer);
  return { file, dir };
}

test('accepts a well-formed zip and reports its entries', async () => {
  const { file, dir } = await writeTemp('a.zip', buildZip([{ name: 'one.txt', data: 'hello' }, { name: 'two.txt', data: 'world' }]));
  const result = await validateZipStructure(file);
  assert.equal(result.valid, true);
  assert.equal(result.entryCount, 2);
  assert.deepEqual(result.names, ['one.txt', 'two.txt']);
  await fs.rm(dir, { recursive: true, force: true });
});

test('rejects a zip with no end-of-central-directory record', async () => {
  const { file, dir } = await writeTemp('bad.zip', buildZip([{ name: 'a.txt' }], { breakEocd: true }));
  const result = await validateZipStructure(file);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'no-eocd');
  await fs.rm(dir, { recursive: true, force: true });
});

test('rejects a truncated file outright', async () => {
  const { file, dir } = await writeTemp('tiny.zip', Buffer.alloc(10));
  const result = await validateZipStructure(file);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'too-small');
  await fs.rm(dir, { recursive: true, force: true });
});

test('a DOCX package must contain its required parts', async () => {
  const good = buildZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'word/document.xml', data: '<w:document/>' },
  ]);
  const { file, dir } = await writeTemp('good.docx', good);
  assert.equal((await validateDocumentPackage(file, 'docx')).valid, true);
  await fs.rm(dir, { recursive: true, force: true });

  // A zip that has the content-types part but no document part is NOT a docx.
  const bad = buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'other.xml', data: 'x' }]);
  const second = await writeTemp('bad.docx', bad);
  const result = await validateDocumentPackage(second.file, 'docx');
  assert.equal(result.valid, false);
  assert.match(result.reason, /missing-parts/);
  await fs.rm(second.dir, { recursive: true, force: true });
});

test('an XLSX and PPTX are checked against their own required parts', async () => {
  const xlsx = buildZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'xl/workbook.xml', data: '<workbook/>' },
  ]);
  const x = await writeTemp('a.xlsx', xlsx);
  assert.equal((await validateDocumentPackage(x.file, 'xlsx')).valid, true);
  await fs.rm(x.dir, { recursive: true, force: true });

  const pptx = buildZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'ppt/presentation.xml', data: '<p/>' },
  ]);
  const p = await writeTemp('a.pptx', pptx);
  assert.equal((await validateDocumentPackage(p.file, 'pptx')).valid, true);
  await fs.rm(p.dir, { recursive: true, force: true });
});

test('a valid tar passes its own checksum check', async () => {
  const { file, dir } = await writeTemp('a.tar', buildTar('notes.txt'));
  const result = await validateArchive(file, 'tar');
  assert.equal(result.valid, true);
  await fs.rm(dir, { recursive: true, force: true });
});

test('a tar whose block was altered fails the checksum', async () => {
  const { file, dir } = await writeTemp('bad.tar', buildTar('notes.txt', { corrupt: true }));
  const result = await validateArchive(file, 'tar');
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'bad-checksum');
  await fs.rm(dir, { recursive: true, force: true });
});

test('gzip is checked for magic, method and a plausible trailer', async () => {
  const good = Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08, 0x00]), Buffer.alloc(40)]);
  const ok = await writeTemp('a.gz', good);
  assert.equal((await validateArchive(ok.file, 'gz')).valid, true);
  await fs.rm(ok.dir, { recursive: true, force: true });

  // Decompressing with a method other than deflate is not a gzip we can trust.
  const bad = await writeTemp('bad.gz', Buffer.concat([Buffer.from([0x1f, 0x8b, 0x09]), Buffer.alloc(40)]));
  assert.equal((await validateArchive(bad.file, 'gz')).valid, false);
  await fs.rm(bad.dir, { recursive: true, force: true });
});

test('archives are flagged as never-modify', () => {
  for (const ext of ['zip', 'rar', '7z', 'tar', 'gz', 'docx', 'xlsx', 'pptx']) {
    assert.equal(mustStoreOriginal(ext), true, `${ext} must be stored as-is`);
    assert.ok(NEVER_MODIFY_EXTS.has(ext));
  }
  assert.equal(mustStoreOriginal('txt'), false);
  assert.equal(mustStoreOriginal('png'), false);
});
