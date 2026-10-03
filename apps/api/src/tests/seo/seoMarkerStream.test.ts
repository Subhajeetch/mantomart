import {
  markerHoldIndex,
  parseSeoCopyText,
  SeoMarkerStreamParser,
  SeoParseError,
} from './seoMarkerStream.ts';

const SAMPLE = `<<<title>>>
Wireless Noise Cancelling Earbuds
<<<description>>>
These earbuds block cabin noise on long flights.
They stay comfortable for hours.

A compact case tops up the charge.
<<<mobileDetailMarkdown>>>
**Highlights**
- Active noise cancelling
- 8-hour battery

**Notes**
- Size 10 is smaller than 12
<<<metaTitle>>>
Wireless Noise Cancelling Earbuds
<<<metaDescription>>>
Shop wireless noise cancelling earbuds with long battery life.
<<<tags>>>
- wireless earbuds
- noise cancelling
- bluetooth 5.3
<<<end>>>`;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function eq<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}\n  expected: ${b}\n  actual:   ${a}`);
}

function runParser(chunks: string[]) {
  const parser = new SeoMarkerStreamParser();
  const events = [];
  for (const chunk of chunks) events.push(...parser.push(chunk));
  events.push(...parser.finish());
  return { parser, events };
}

function titleDeltas(events: { field: string; delta: string; done: boolean }[]) {
  return events
    .filter((e) => e.field === 'title' && e.delta)
    .map((e) => e.delta)
    .join('');
}

let passed = 0;

function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
}

test('parses a complete marked document', () => {
  const parsed = parseSeoCopyText(SAMPLE);
  eq(parsed.title, 'Wireless Noise Cancelling Earbuds', 'title');
  assert(parsed.description.includes('cabin noise'), 'description');
  assert(parsed.mobileDetailMarkdown.includes('**Highlights**'), 'markdown');
  eq(parsed.tags, ['wireless earbuds', 'noise cancelling', 'bluetooth 5.3'], 'tags');
});

test('streams token-sized chunks as deltas', () => {
  const chunks = [];
  for (const ch of SAMPLE) chunks.push(ch);
  const { parser, events } = runParser(chunks);
  assert(events.some((e) => e.field === 'title' && e.delta === 'W'), 'first title char');
  assert(events.filter((e) => e.field === 'title' && e.delta.length > 0).length > 5, 'many title deltas');
  eq(parser.assembled.title, 'Wireless Noise Cancelling Earbuds', 'assembled title');
  eq(parser.isClosed('title'), true, 'title closed');
  eq(parser.assembled.tags.length, 3, 'three tags');
});

test('holds a marker split across chunks', () => {
  const { parser, events } = runParser([
    'preamble\n<<<ti',
    'tle>>>\nHello world',
    '\n<<<description>>>\nBody text here that is useful.',
    '\n<<<mobileDetailMarkdown>>>\n**Notes**\n- one',
    '\n<<<metaTitle>>>\nMeta title here',
    '\n<<<metaDescription>>>\nMeta description here for the snippet.',
    '\n<<<tags>>>\n- alpha\n- beta\n<<<end>>>',
  ]);
  eq(titleDeltas(events), 'Hello world', 'split marker title');
  eq(parser.assembled.description, 'Body text here that is useful.', 'description');
  eq(parser.assembled.tags, ['alpha', 'beta'], 'tags');
});

test('does not emit a partial <<< as content', () => {
  eq(markerHoldIndex('hello <'), 5, 'hold space+<');
  eq(markerHoldIndex('hello <<'), 5, 'hold space+<<');
  eq(markerHoldIndex('hello <<<ti'), 5, 'hold space+<<<ti');
  eq(markerHoldIndex('hello world'), 11, 'emit all');
  eq(markerHoldIndex('hello \n', true), 5, 'hold trailing ws');
  eq(markerHoldIndex('hello \n<<<ti', true), 5, 'hold ws before partial marker');
  const { events } = runParser([
    '<<<title>>>\nsize ',
    '<',
    ' 10 earbuds',
    '\n<<<description>>>\nDesc text for this product is long enough.',
    '\n<<<mobileDetailMarkdown>>>\n**Fit**\n- small',
    '\n<<<end>>>',
  ]);
  const title = titleDeltas(events);
  assert(title.includes('size < 10 earbuds'), `title was ${title}`);
});

test('emits tags only after a complete line', () => {
  const parser = new SeoMarkerStreamParser();
  const mid = parser.push('<<<tags>>>\n- wireless ear');
  eq(
    mid.filter((e) => e.field === 'tags' && e.delta).length,
    0,
    'no partial tag'
  );
  const more = parser.push('buds\n- noise cancelling\n');
  eq(
    more.filter((e) => e.delta).map((e) => e.delta),
    ['wireless earbuds', 'noise cancelling'],
    'complete tags'
  );
});

test('parses JSON-array tags at field close', () => {
  const { parser } = runParser([
    '<<<title>>>\nJSON Tag Title Here\n',
    '<<<description>>>\nA description that is definitely long enough.\n',
    '<<<mobileDetailMarkdown>>>\n**Notes**\n- boxed\n',
    '<<<tags>>>\n["red case", "blue case"]\n<<<end>>>',
  ]);
  eq(parser.assembled.tags, ['red case', 'blue case'], 'json tags');
});

test('falls back to JSON when there are no markers', () => {
  const parsed = parseSeoCopyText(
    JSON.stringify({
      title: 'JSON Title Product',
      description: 'JSON description for the product copy.',
      mobileDetailMarkdown: '**Notes**\n- json',
      metaTitle: 'JSON Meta',
      metaDescription: 'JSON meta description text.',
      tags: ['one', 'two'],
    })
  );
  eq(parsed.title, 'JSON Title Product', 'json title');
  eq(parsed.tags, ['one', 'two'], 'json tags');
});

test('does not scrape markers out of a JSON payload', () => {
  const parser = new SeoMarkerStreamParser();
  const json = JSON.stringify({
    title: 'Keep JSON <<<title>>> inside',
    description: 'JSON description for the product copy.',
    mobileDetailMarkdown: '**Notes**\n- json',
    tags: ['one'],
  });
  const events = [...parser.push(json), ...parser.finish()];
  eq(events.length, 0, 'no marker events from json');
  eq(parser.sawMarker, false, 'sawMarker');
  eq(parser.jsonLocked, true, 'jsonLocked');
});

test('strips a wrapping code fence', () => {
  const parsed = parseSeoCopyText('```\n' + SAMPLE + '\n```');
  eq(parsed.title, 'Wireless Noise Cancelling Earbuds', 'fenced title');
});

test('rejects missing required fields', () => {
  try {
    parseSeoCopyText('<<<title>>>\nOnly a title\n<<<end>>>');
    throw new Error('should have thrown');
  } catch (err) {
    assert(err instanceof SeoParseError, 'SeoParseError');
    eq(err.code, 'GEMINI_INCOMPLETE', 'code');
  }
});

test('unknown <<<foo>>> stays in field content', () => {
  const { parser } = runParser([
    '<<<title>>>\nSee <<<foo>>> inside title text\n',
    '<<<description>>>\nDescription body for this product.\n',
    '<<<mobileDetailMarkdown>>>\n**Notes**\n- x\n<<<end>>>',
  ]);
  assert(parser.assembled.title.includes('<<<foo>>>'), 'kept unknown marker');
});

test('same-line content after a marker', () => {
  const { parser } = runParser([
    '<<<title>>> Same Line Title Text\n<<<description>>>Desc body for product.\n<<<mobileDetailMarkdown>>>**Notes**\n- y\n<<<end>>>',
  ]);
  eq(parser.assembled.title, 'Same Line Title Text', 'same line title');
});

test('dedupes tags and caps length', () => {
  const { parser } = runParser([
    '<<<title>>>\nTitle\n<<<description>>>\nDesc\n<<<mobileDetailMarkdown>>>\nMd\n<<<tags>>>\n- Alpha\n- alpha\n- Beta\n<<<end>>>',
  ]);
  eq(parser.assembled.tags, ['Alpha', 'Beta'], 'deduped tags');
});

console.log(`\n${passed} tests passed`);
