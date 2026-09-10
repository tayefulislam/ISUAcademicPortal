import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize,
  tokenize,
  editDistance,
  adaptiveThreshold,
  scoreDocument,
  suggestCorrection,
  sanitizeQuery,
  MAX_QUERY_LENGTH,
} from './textSearch.js';

// Builds the same `fields` shape questionController.searchFieldsFor produces,
// scoped down to just questionText for tests that only care about the
// primary field.
function questionDoc(text, extra = {}) {
  return [
    { key: 'questionText', weight: 10, value: text },
    { key: 'tags', weight: 7, value: extra.tags || [] },
    { key: 'topic', weight: 6, value: extra.topic || '' },
  ];
}

function scoreOf(query, text, extra) {
  return scoreDocument(tokenize(query), questionDoc(text, extra));
}

describe('normalize', () => {
  test('lowercases, strips punctuation, collapses whitespace', () => {
    assert.equal(normalize('  What... IS   Photosynthesis?! '), 'what is photosynthesis');
  });

  test('strips diacritics', () => {
    assert.equal(normalize('café résumé'), 'cafe resume');
  });
});

describe('tokenize', () => {
  test('splits normalized text into words', () => {
    assert.deepEqual(tokenize('What is Photosynthesis?'), ['what', 'is', 'photosynthesis']);
  });

  test('empty/whitespace input yields no tokens', () => {
    assert.deepEqual(tokenize('   '), []);
    assert.deepEqual(tokenize(''), []);
  });
});

describe('editDistance (Damerau-Levenshtein)', () => {
  test('identical strings have distance 0', () => {
    assert.equal(editDistance('question', 'question'), 0);
  });

  test('one substitution costs 1', () => {
    assert.equal(editDistance('question', 'questoon'), 1);
  });

  test('one adjacent transposition costs 1, not 2', () => {
    // "qeustion" swaps the 2nd/3rd letters of "question" (e<->u).
    assert.equal(editDistance('question', 'qeustion'), 1);
  });

  test('one deletion (missing char) costs 1', () => {
    assert.equal(editDistance('question', 'questin'), 1); // missing 'o'
  });

  test('one insertion (extra char) costs 1', () => {
    assert.equal(editDistance('question', 'questiion'), 1);
  });
});

describe('adaptiveThreshold', () => {
  test('short words (<=3 chars) require an exact/prefix match', () => {
    assert.equal(adaptiveThreshold(1), 0);
    assert.equal(adaptiveThreshold(3), 0);
  });

  test('medium words (4-6 chars) allow one edit', () => {
    assert.equal(adaptiveThreshold(4), 1);
    assert.equal(adaptiveThreshold(6), 1);
  });

  test('long words (7+ chars) allow two edits', () => {
    assert.equal(adaptiveThreshold(7), 2);
    assert.equal(adaptiveThreshold(20), 2);
  });
});

describe('scoreDocument — exact, prefix and fuzzy typo tolerance', () => {
  const DOC = 'What is a question?';

  test('exact word match scores as type "exact"', () => {
    const r = scoreOf('question', DOC);
    assert.ok(r);
    assert.equal(r.matchType, 'exact');
  });

  test('exact phrase substring gives the strongest score (outranks a fuzzy hit elsewhere)', () => {
    const exact = scoreOf('what is a question', DOC);
    const fuzzy = scoreOf('quetion', DOC);
    assert.ok(exact.score > fuzzy.score);
  });

  // Every misspelling of "question" called out in the spec must still find
  // a document containing the word "question".
  const typoVariants = [
    'questi', 'questin', 'queston', 'quesion', 'qution', 'quetion',
    'qustion', 'questio', 'ques', 'quest', 'que', 'qeustion', 'quiestion', 'qusetion',
  ];

  for (const typo of typoVariants) {
    test(`typo "${typo}" still matches "question"`, () => {
      const r = scoreOf(typo, DOC);
      assert.ok(r, `expected "${typo}" to match, got no match`);
      assert.ok(r.score > 0);
    });
  }

  test('partial/prefix query "photo" matches "photosynthesis"', () => {
    // Being a literal substring of the normalized text also satisfies the
    // whole-phrase bonus, which legitimately outranks it to "exact" — either
    // way it must not be a weak fuzzy match or no match at all.
    const r = scoreOf('photo', 'What is photosynthesis?');
    assert.ok(r);
    assert.ok(['exact', 'prefix'].includes(r.matchType));
  });

  test('partial/prefix query "comput" matches "computer"', () => {
    const r = scoreOf('comput', 'Which of these is a computer component?');
    assert.ok(r);
    assert.ok(['exact', 'prefix'].includes(r.matchType));
  });

  test('a query under 4 chars stays type "prefix" (whole-phrase bonus only applies at 4+ chars)', () => {
    // "que" is a strict word-prefix of "question", but is short enough that
    // the whole-phrase substring bonus (gated to >=4 chars) never fires —
    // isolates the prefix-matching branch itself from that bonus.
    const r = scoreOf('que', DOC);
    assert.ok(r);
    assert.equal(r.matchType, 'prefix');
  });

  test('reordered multi-word query still matches ("photosynthesis what" -> "What is photosynthesis?")', () => {
    const r = scoreOf('photosynthesis what', 'What is photosynthesis?');
    assert.ok(r);
  });

  test('ranking: exact > prefix > fuzzy for the same document family', () => {
    const exact = scoreOf('question', DOC);
    const prefix = scoreOf('quest', DOC);
    const fuzzy = scoreOf('qution', DOC);
    assert.ok(exact.score > prefix.score);
    assert.ok(prefix.score > fuzzy.score);
  });

  test('unrelated short word does not falsely match a single-letter field value (regression)', () => {
    // A bare MCQ option label like "T"/"B"/"D" must not act as a wildcard
    // that "prefix-matches" any query starting with that same letter.
    const r = scoreDocument(tokenize('banana'), [
      { key: 'questionText', weight: 10, value: 'What is a question?' },
      { key: 'options', weight: 4, value: ['T', 'B', 'D'] },
    ]);
    assert.equal(r, null);
  });

  test('completely unrelated query returns no match', () => {
    const r = scoreOf('xylophone', DOC);
    assert.equal(r, null);
  });

  test('very short exact query ("is") only matches via a real token, not noise', () => {
    const r = scoreOf('is', DOC);
    assert.ok(r);
    assert.equal(r.matchType, 'exact');
  });
});

describe('suggestCorrection ("did you mean")', () => {
  const corpus = ['What is a question?', 'Explain photosynthesis in plants'];

  test('suggests the corrected real word for a fuzzy-matched typo', () => {
    const suggestion = suggestCorrection(tokenize('quetion'), corpus, 'fuzzy');
    assert.equal(suggestion, 'question');
  });

  test('does not second-guess an already exact match', () => {
    const suggestion = suggestCorrection(tokenize('question'), corpus, 'exact');
    assert.equal(suggestion, null);
  });

  test('does not second-guess an already good prefix match', () => {
    const suggestion = suggestCorrection(tokenize('quest'), corpus, 'prefix');
    assert.equal(suggestion, null);
  });
});

describe('sanitizeQuery', () => {
  test('trims surrounding whitespace', () => {
    assert.equal(sanitizeQuery('  question  '), 'question');
  });

  test('caps length at MAX_QUERY_LENGTH to prevent abuse', () => {
    const long = 'a'.repeat(MAX_QUERY_LENGTH + 50);
    assert.equal(sanitizeQuery(long).length, MAX_QUERY_LENGTH);
  });

  test('non-string input is coerced safely', () => {
    assert.equal(sanitizeQuery(null), '');
    assert.equal(sanitizeQuery(undefined), '');
  });
});
