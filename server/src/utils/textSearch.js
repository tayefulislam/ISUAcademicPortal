// Typo-tolerant, weighted, token-based search engine shared by every place
// that searches the Question Bank (Question Bank page, the Exam Builder's
// question picker, the dedicated /questions/search endpoint). Pure
// vanilla JS — no new dependency — so a query like "qeustion", "qution", or
// "que" can still find a question containing "question".
//
// Design (see the "Search Index" section of the spec this was built
// against): rather than scanning an entire collection with expensive
// per-document JS scoring, callers first narrow candidates with a cheap,
// indexed Mongo filter (department/course/chapter/etc — already required
// for every Question Bank query) and cap the result with CANDIDATE_CAP.
// Only that bounded candidate set is scored/ranked here, in memory. For a
// single scope growing past a few thousand questions, upgrade the
// candidate-fetch step to MongoDB Atlas Search — this module's scoring
// logic would stay the same, only the candidate source would change.

export const CANDIDATE_CAP = 500;
export const MAX_QUERY_LENGTH = 200;

// Configurable per spec — how much each field contributes to a document's
// relevance score. Tune freely; nothing else needs to change.
export const FIELD_WEIGHTS = {
  questionText: 10,
  tags: 7,
  topic: 6,
  subject: 5, // course/department name
  options: 4,
  explanation: 3,
};

// ----- Normalization -----

// Lowercase, Unicode-normalize and strip diacritics, drop punctuation
// (keep letters/digits/spaces), collapse repeated whitespace, trim. Two
// strings that only differ by case/accents/punctuation/spacing normalize
// to the same thing.
export function normalize(str) {
  return String(str || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(str) {
  const n = normalize(str);
  return n ? n.split(' ') : [];
}

// ----- Edit distance -----

// Damerau-Levenshtein (optimal string alignment variant) — like plain
// Levenshtein but also treats one adjacent-character swap ("qeustion" vs
// "question") as a single edit instead of two, which matters for the
// "swapped characters" typo case called out explicitly in the spec.
export function editDistance(a, b) {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  const d = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost); // transposition
      }
    }
  }
  return d[al][bl];
}

// Adaptive tolerance by word length (spec §10): short words must be near-
// exact (typing "que" shouldn't fuzzy-match half the dictionary), longer
// words can absorb more typos.
export function adaptiveThreshold(len) {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

// ----- Token matching -----

// Scores one query token against one target token. Returns null if they
// don't match at all under the adaptive threshold.
function matchToken(queryToken, targetToken) {
  if (!queryToken || !targetToken) return null;
  if (queryToken === targetToken) return { score: 1, type: 'exact' };

  // Prefix in either direction — "quest" -> "question" (partial query) and
  // "question" -> "questions" (target is a short inflection of the query).
  // Both sides must be at least 2 characters: without this, a 1-character
  // field value (a bare MCQ option label like "T"/"B"/"D") would trivially
  // "prefix-match" almost any query that happens to start with that letter
  // (queryToken.startsWith('b') is true for "banana", "binary", etc.) —
  // this was a real false-positive bug caught during testing.
  const shorterLen = Math.min(queryToken.length, targetToken.length);
  if (shorterLen >= 2 && (targetToken.startsWith(queryToken) || queryToken.startsWith(targetToken))) {
    // Prefix matching is exact-character matching (no typo tolerance), so
    // it's inherently "strict" and safe even for very short queries — "que"
    // legitimately prefixes "question". A shorter/less-specific fragment
    // just scores lower, which naturally ranks it below a fuller match
    // rather than needing to be rejected outright.
    const longer = Math.max(queryToken.length, targetToken.length);
    const shorter = Math.min(queryToken.length, targetToken.length);
    return { score: 0.6 + 0.4 * (shorter / longer), type: 'prefix' };
  }

  // Threshold scales with the longer of the two tokens — a short, typo'd
  // fragment of a long word (e.g. "qution" for "question") needs the
  // target's length to size the allowance, not just the fragment's own
  // (short) length, or it would never be considered a fuzzy candidate.
  const threshold = adaptiveThreshold(Math.max(queryToken.length, targetToken.length));
  if (threshold === 0) return null; // both tokens short: exact/prefix only, no fuzz
  const dist = editDistance(queryToken, targetToken);
  if (dist > threshold) return null;
  const maxLen = Math.max(queryToken.length, targetToken.length);
  return { score: 0.5 + 0.4 * (1 - dist / maxLen), type: 'fuzzy' };
}

// Best match of `queryToken` against any token in `fieldTokens`.
function bestTokenMatch(queryToken, fieldTokens) {
  let best = null;
  for (const t of fieldTokens) {
    const m = matchToken(queryToken, t);
    if (m && (!best || m.score > best.score)) best = m;
  }
  return best;
}

const MATCH_TYPE_RANK = { exact: 4, prefix: 3, fuzzy: 2, none: 0 };

// ----- Document scoring -----

// `fields` = [{ key, weight, value }] — value is the raw (unnormalized)
// field content (string, or array of strings e.g. tags/options).
// Returns { score, matchType, matchedField } or null if nothing matched.
export function scoreDocument(queryTokens, fields) {
  let total = 0;
  let bestType = 'none';
  let matchedField = null;
  let anyMatch = false;

  for (const { key, weight, value } of fields) {
    const values = Array.isArray(value) ? value : [value];
    const fieldTokens = values.flatMap((v) => tokenize(v));
    if (!fieldTokens.length) continue;

    let fieldScore = 0;
    let fieldType = 'none';
    for (const qt of queryTokens) {
      const m = bestTokenMatch(qt, fieldTokens);
      if (m) {
        fieldScore += m.score;
        anyMatch = true;
        if (MATCH_TYPE_RANK[m.type] > MATCH_TYPE_RANK[fieldType]) fieldType = m.type;
      }
    }
    if (fieldScore > 0) {
      // Average per query-token so a field isn't rewarded just for being
      // long; then weight by field importance.
      const normalized = (fieldScore / queryTokens.length) * weight;
      total += normalized;
      if (MATCH_TYPE_RANK[fieldType] > MATCH_TYPE_RANK[bestType]) {
        bestType = fieldType;
        matchedField = key;
      }
    }
  }

  // Whole-phrase substring bonus — an exact phrase hit (even typo-free
  // multi-word queries) should always outrank a same-type single-token
  // fuzzy hit elsewhere. Gated to queries of at least 4 characters (§10's
  // "1-3 characters: very strict") so a 2-3 char fragment can't match
  // merely by appearing mid-word somewhere in an unrelated sentence — short
  // queries still rely on the stricter per-token prefix logic above.
  // "Primary" is whichever field the caller weighted highest (questionText
  // for questions, title for files, etc.) — not a hardcoded key — so this
  // same scoring function works for any document shape callers pass in.
  const primary = fields.reduce((best, f) => (!best || f.weight > best.weight ? f : best), null);
  if (primary) {
    const normQuery = queryTokens.join(' ');
    const normPrimary = normalize(Array.isArray(primary.value) ? primary.value.join(' ') : primary.value);
    if (normQuery.length >= 4 && normPrimary.includes(normQuery)) {
      total += primary.weight * 2;
      bestType = 'exact';
      matchedField = primary.key;
      anyMatch = true;
    }
  }

  if (!anyMatch) return null;
  return { score: total, matchType: bestType, matchedField };
}

// ----- "Did you mean" -----

// Builds a corpus of real words actually present in the candidate set
// (question text + tags), then finds the closest whole-word correction for
// each query token that didn't already match exactly/by prefix. Returns
// null when the query already matched well (never second-guess a good hit).
export function suggestCorrection(queryTokens, candidateFields, topResultMatchType) {
  if (topResultMatchType === 'exact' || topResultMatchType === 'prefix') return null;

  const corpus = new Map(); // token -> frequency
  for (const doc of candidateFields) {
    for (const t of tokenize(doc)) {
      corpus.set(t, (corpus.get(t) || 0) + 1);
    }
  }

  const corrected = queryTokens.map((qt) => {
    if (corpus.has(qt)) return qt;
    let best = null;
    for (const [word, freq] of corpus) {
      if (Math.abs(word.length - qt.length) > 3) continue;
      const dist = editDistance(qt, word);
      const threshold = Math.max(1, adaptiveThreshold(qt.length) + 1);
      if (dist <= threshold && (!best || dist < best.dist || (dist === best.dist && freq > best.freq))) {
        best = { word, dist, freq };
      }
    }
    return best ? best.word : qt;
  });

  const suggestion = corrected.join(' ');
  const original = queryTokens.join(' ');
  return suggestion !== original ? suggestion : null;
}

export function sanitizeQuery(raw) {
  return String(raw || '').slice(0, MAX_QUERY_LENGTH).trim();
}
