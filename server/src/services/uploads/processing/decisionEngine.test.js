import test from 'node:test';
import assert from 'node:assert/strict';
import { determineOptimizationStrategy } from './decisionEngine.js';

/**
 * These tests pin the decision ENGINE's rules directly, with fabricated
 * analyses — which is the point of separating the engine from the I/O: the
 * "do NOT blindly compress everything" policy is verifiable without touching a
 * file, a database or a bucket.
 */

function analysis(overrides = {}) {
  return {
    ext: 'bin',
    mime: 'application/octet-stream',
    category: 'other',
    alreadyCompressed: false,
    textLike: false,
    dangerous: false,
    optimizationSafe: true,
    unsafeReason: '',
    size: 1024,
    reencodableImageCount: 0,
    ...overrides,
  };
}

test('refuses an executable outright', () => {
  const result = determineOptimizationStrategy(analysis({ dangerous: true, ext: 'exe', category: 'other' }));
  assert.equal(result.strategy, 'reject');
});

test('never transcodes video', () => {
  const result = determineOptimizationStrategy(analysis({ ext: 'mp4', category: 'video', alreadyCompressed: true }));
  assert.equal(result.strategy, 'none');
  assert.equal(result.reason, 'video-not-transcoded');
});

test('never transcodes audio', () => {
  const result = determineOptimizationStrategy(analysis({ ext: 'mp3', category: 'audio', alreadyCompressed: true }));
  assert.equal(result.strategy, 'none');
  assert.equal(result.reason, 'audio-not-transcoded');
});

test('never rewrites an archive', () => {
  const result = determineOptimizationStrategy(analysis({ ext: 'zip', category: 'archive', alreadyCompressed: true }));
  assert.equal(result.strategy, 'none');
  assert.equal(result.reason, 'archive-stored-as-is');
});

test('stores an already-optimized JPEG unchanged rather than re-compressing it (§8)', () => {
  const result = determineOptimizationStrategy(
    analysis({ ext: 'jpg', category: 'image', alreadyCompressed: true, width: 1920, height: 1080 })
  );
  assert.equal(result.strategy, 'none');
  assert.equal(result.reason, 'image-already-optimized');
});

test('a PNG at a sensible size also stays put', () => {
  const result = determineOptimizationStrategy(
    analysis({ ext: 'png', category: 'image', alreadyCompressed: true, width: 800, height: 600 })
  );
  assert.equal(result.strategy, 'none');
  assert.equal(result.reason, 'image-already-optimized');
});

test('an OVERSIZED JPEG IS resized — that is a real win (§4)', () => {
  const result = determineOptimizationStrategy(
    analysis({ ext: 'jpg', category: 'image', alreadyCompressed: true, width: 6000, height: 4000 })
  );
  assert.equal(result.strategy, 'image-optimize');
  assert.equal(result.reason, 'image-resize');
});

test('TIFF/BMP (no built-in compression) are always worth converting', () => {
  const tiff = determineOptimizationStrategy(
    analysis({ ext: 'tiff', category: 'image', alreadyCompressed: false, width: 800, height: 600 })
  );
  assert.equal(tiff.strategy, 'image-optimize');
  assert.equal(tiff.reason, 'image-reencode');

  const bmp = determineOptimizationStrategy(
    analysis({ ext: 'bmp', category: 'image', alreadyCompressed: false, width: 200, height: 200 })
  );
  assert.equal(bmp.strategy, 'image-optimize');
});

test('optimizes a PDF that has re-encodable images', () => {
  const result = determineOptimizationStrategy(analysis({ ext: 'pdf', category: 'document', reencodableImageCount: 12 }));
  assert.equal(result.strategy, 'pdf-optimize');
  assert.equal(result.profile, 'BALANCED');
});

test('does not rebuild a PDF with no re-encodable images', () => {
  const result = determineOptimizationStrategy(analysis({ ext: 'pdf', category: 'document', reencodableImageCount: 0 }));
  assert.equal(result.strategy, 'none');
  assert.equal(result.reason, 'pdf-has-no-reencodable-images');
});

test('compresses text-like files', () => {
  const result = determineOptimizationStrategy(
    analysis({ ext: 'json', category: 'document', textLike: true, size: 5 * 1024 * 1024 })
  );
  assert.equal(result.strategy, 'text-compress');
});

test('does not bother compressing a tiny text file', () => {
  const result = determineOptimizationStrategy(analysis({ ext: 'txt', category: 'document', textLike: true, size: 100 }));
  assert.equal(result.strategy, 'none');
  assert.equal(result.reason, 'below-text-size-floor');
});

test('SVG goes down the text path, not the image path', () => {
  const result = determineOptimizationStrategy(
    analysis({ ext: 'svg', category: 'image', textLike: true, alreadyCompressed: false, size: 200000 })
  );
  assert.equal(result.strategy, 'text-compress');
});

test('an animated GIF is never re-encoded', () => {
  const result = determineOptimizationStrategy(
    analysis({ ext: 'gif', category: 'image', optimizationSafe: false, unsafeReason: 'animated' })
  );
  assert.equal(result.strategy, 'none');
  assert.match(result.reason, /unsafe:animated/);
});

test('an encrypted PDF is left alone', () => {
  const result = determineOptimizationStrategy(
    analysis({ ext: 'pdf', category: 'document', optimizationSafe: false, unsafeReason: 'encrypted' })
  );
  assert.equal(result.strategy, 'none');
  assert.match(result.reason, /unsafe:encrypted/);
});

test('an unknown binary is stored untouched', () => {
  const result = determineOptimizationStrategy(analysis({ ext: '', category: 'other' }));
  assert.equal(result.strategy, 'none');
});

test('an unknown profile falls back to BALANCED instead of failing', () => {
  const result = determineOptimizationStrategy(analysis({ ext: 'pdf', reencodableImageCount: 3 }), {
    profile: 'NOT_A_PROFILE',
  });
  assert.equal(result.strategy, 'pdf-optimize');
  assert.equal(result.profile, 'BALANCED');
});

test('honours an explicit quality profile', () => {
  const result = determineOptimizationStrategy(analysis({ ext: 'pdf', reencodableImageCount: 3 }), {
    profile: 'SMALL_SIZE',
  });
  assert.equal(result.profile, 'SMALL_SIZE');
});
