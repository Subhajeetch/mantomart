/**
 * Incremental parser for Gemini SEO copy streamed as marked text, e.g.
 *
 *   <<<title>>>
 *   ...
 *   <<<description>>>
 *   ...
 *   <<<tags>>>
 *   - tag one
 *   <<<end>>>
 *
 * Emits { field, delta, done } as tokens arrive so the UI can append live.
 */

export type SeoStreamFieldName =
  | 'title'
  | 'description'
  | 'mobileDetailMarkdown'
  | 'metaTitle'
  | 'metaDescription'
  | 'tags';

export const SEO_STREAM_FIELD_ORDER: readonly SeoStreamFieldName[] = [
  'title',
  'description',
  'mobileDetailMarkdown',
  'metaTitle',
  'metaDescription',
  'tags',
] as const;

export type SeoAssembledFields = {
  title: string;
  description: string;
  mobileDetailMarkdown: string;
  metaTitle: string;
  metaDescription: string;
  tags: string[];
};

export type SeoFieldDeltaEvent = {
  field: SeoStreamFieldName;
  delta: string;
  done: boolean;
};

export class SeoParseError extends Error {
  code: string;
  publicMessage: string;

  constructor(
    code: string,
    message: string,
    publicMessage = message
  ) {
    super(message);
    this.name = 'SeoParseError';
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export const SEO_FIELD_MAX: Record<
  Exclude<SeoStreamFieldName, 'tags'>,
  number
> = {
  title: 300,
  description: 12_000,
  mobileDetailMarkdown: 20_000,
  metaTitle: 120,
  metaDescription: 320,
};

const MAX_TAGS = 20;
const MAX_TAG_LEN = 60;

const FIELD_ALIASES: Record<string, SeoStreamFieldName> = {
  title: 'title',
  description: 'description',
  mobiledetailmarkdown: 'mobileDetailMarkdown',
  mobile_detail_markdown: 'mobileDetailMarkdown',
  mobilemarkdown: 'mobileDetailMarkdown',
  mobile_markdown: 'mobileDetailMarkdown',
  mobiledescription: 'mobileDetailMarkdown',
  mobile_description: 'mobileDetailMarkdown',
  metatitle: 'metaTitle',
  meta_title: 'metaTitle',
  metadescription: 'metaDescription',
  meta_description: 'metaDescription',
  tags: 'tags',
};

function resolveMarkerName(
  raw: string
): SeoStreamFieldName | 'end' | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!key) return null;
  if (key === 'end' || key === 'done' || key === 'stop' || key === 'eof') {
    return 'end';
  }
  return FIELD_ALIASES[key] ?? null;
}

function findNextMarker(buf: string): {
  kind: SeoStreamFieldName | 'end';
  start: number;
  end: number;
} | null {
  let from = 0;
  while (from < buf.length) {
    const start = buf.indexOf('<<<', from);
    if (start === -1) return null;
    const close = buf.indexOf('>>>', start + 3);
    if (close === -1) return null;
    const kind = resolveMarkerName(buf.slice(start + 3, close));
    if (kind) return { kind, start, end: close + 3 };
    from = start + 3;
  }
  return null;
}

function rewindWhitespace(buf: string, index: number): number {
  let i = index;
  while (i > 0 && /[ \t\r\n]/.test(buf[i - 1])) i -= 1;
  return i;
}

/**
 * Index to hold back so a marker split across chunks is not emitted as content.
 * Always holds an unclosed `<<<...` or trailing `<` / `<<`.
 * For string fields, also holds trailing whitespace so the newline before the
 * next marker is not appended to the value. Tags need those newlines to flush.
 */
export function markerHoldIndex(
  buf: string,
  holdTrailingWhitespace = false
): number {
  const lastOpen = buf.lastIndexOf('<<<');
  if (lastOpen !== -1 && buf.indexOf('>>>', lastOpen + 3) === -1) {
    return rewindWhitespace(buf, lastOpen);
  }
  if (buf.endsWith('<<')) return rewindWhitespace(buf, buf.length - 2);
  if (buf.endsWith('<')) return rewindWhitespace(buf, buf.length - 1);
  if (holdTrailingWhitespace) return rewindWhitespace(buf, buf.length);
  return buf.length;
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of tags) {
    if (typeof item !== 'string') continue;
    const tag = item.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LEN);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function parseTagLine(line: string): string[] {
  let s = line.trim();
  if (!s) return [];
  if (
    s === '[' ||
    s === ']' ||
    s === ',' ||
    s === '```' ||
    /^```[a-zA-Z]*$/.test(s)
  ) {
    return [];
  }

  s = s.replace(/^[-*•]\s*/, '');
  s = s.replace(/^\d+[.)]\s+/, '');
  s = s.replace(/^["']/, '').replace(/["'],?$/, '').trim();
  if (!s || s === '[' || s === ']') return [];

  if (s.includes(',')) {
    const parts = s
      .split(',')
      .map((p) => p.trim().replace(/^["']|["']$/g, '').trim())
      .filter((p) => p.length >= 2 && p.length <= MAX_TAG_LEN);
    if (parts.length >= 2) return parts;
  }

  return [s];
}

function emptyAssembled(): SeoAssembledFields {
  return {
    title: '',
    description: '',
    mobileDetailMarkdown: '',
    metaTitle: '',
    metaDescription: '',
    tags: [],
  };
}

export function stripCodeFences(raw: string): string {
  let s = raw.replace(/^\uFEFF/, '').trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
  }
  return s.trim();
}

export class SeoMarkerStreamParser {
  private buffer = '';
  private current: SeoStreamFieldName | null = null;
  private skipLead = false;
  private ended = false;
  private fenceChecked = false;
  private tagCarry = '';
  private tagsJson = false;
  private seenTagKeys = new Set<string>();
  private closed = new Set<SeoStreamFieldName>();
  /** True when the payload looks like JSON, so we do not scrape markers out of it. */
  jsonLocked = false;

  readonly assembled: SeoAssembledFields = emptyAssembled();
  /** True once at least one known field marker has been seen. */
  sawMarker = false;

  isClosed(field: SeoStreamFieldName): boolean {
    return this.closed.has(field);
  }

  push(chunk: string): SeoFieldDeltaEvent[] {
    if (this.ended || !chunk) return [];
    if (!this.sawMarker && this.buffer.length === 0) {
      chunk = chunk.replace(/^\uFEFF/, '');
    }
    this.buffer += chunk;
    return this.consume(false);
  }

  finish(): SeoFieldDeltaEvent[] {
    if (this.ended) return [];
    const events = this.consume(true);
    this.ended = true;
    return events;
  }

  private consume(flush: boolean): SeoFieldDeltaEvent[] {
    const events: SeoFieldDeltaEvent[] = [];
    this.stripLeadingFence(flush);
    this.lockJsonIfNeeded();
    if (this.jsonLocked) return events;

    while (!this.ended) {
      if (this.current === null) {
        const marker = findNextMarker(this.buffer);
        if (!marker) {
          if (flush) this.buffer = '';
          else this.buffer = this.buffer.slice(markerHoldIndex(this.buffer));
          break;
        }
        this.buffer = this.buffer.slice(marker.end);
        if (marker.kind === 'end') {
          this.ended = true;
          this.buffer = '';
          break;
        }
        this.openField(marker.kind);
        continue;
      }

      const marker = findNextMarker(this.buffer);
      if (marker) {
        const raw = this.buffer.slice(0, marker.start);
        this.buffer = this.buffer.slice(marker.end);
        events.push(...this.appendContent(raw, true));
        if (marker.kind === 'end') {
          this.ended = true;
          this.buffer = '';
          break;
        }
        this.openField(marker.kind);
        continue;
      }

      if (flush) {
        const leftover = this.stripTrailingFence(this.buffer);
        this.buffer = '';
        events.push(...this.appendContent(leftover, true));
        break;
      }

      const hold = markerHoldIndex(
        this.buffer,
        this.current !== null && this.current !== 'tags'
      );
      const emit = this.buffer.slice(0, hold);
      this.buffer = this.buffer.slice(hold);
      if (emit) events.push(...this.appendContent(emit, false));
      break;
    }

    return events;
  }

  private lockJsonIfNeeded(): void {
    if (this.jsonLocked || this.sawMarker || this.current !== null) return;
    if (this.buffer.trimStart().startsWith('{')) this.jsonLocked = true;
  }

  private stripLeadingFence(flush: boolean): void {
    if (this.fenceChecked || this.sawMarker) return;

    const m = this.buffer.match(/^\s*```[a-zA-Z]*[ \t]*\r?\n/);
    if (m) {
      this.buffer = this.buffer.slice(m[0].length);
      this.fenceChecked = true;
      return;
    }

    if (/^\s*```[a-zA-Z]*[ \t]*$/.test(this.buffer)) {
      if (flush) {
        this.buffer = '';
        this.fenceChecked = true;
      }
      return;
    }

    const trimmed = this.buffer.trimStart();
    if (trimmed.startsWith('```')) return;
    if (trimmed.length > 0 || flush) this.fenceChecked = true;
  }

  private stripTrailingFence(text: string): string {
    return text.replace(/(?:\r?\n)?```[ \t]*$/, '');
  }

  private openField(field: SeoStreamFieldName): void {
    this.current = field;
    this.skipLead = true;
    this.sawMarker = true;
    this.closed.delete(field);
    if (field === 'tags') {
      this.tagCarry = '';
      this.tagsJson = false;
    }
  }

  private appendContent(raw: string, close: boolean): SeoFieldDeltaEvent[] {
    const field = this.current;
    if (!field) return [];

    let text = raw;
    if (this.skipLead) {
      text = text.replace(/^\s+/, '');
      if (text.length > 0 || close) this.skipLead = false;
    }
    if (close) {
      text = this.stripTrailingFence(text).replace(/\s+$/, '');
    }

    const events: SeoFieldDeltaEvent[] =
      field === 'tags'
        ? this.appendTags(text, close)
        : this.appendString(field, text, close);

    if (close) {
      if (field !== 'tags') {
        this.assembled[field] = this.assembled[field].replace(/\s+$/, '');
      }
      this.current = null;
      this.closed.add(field);
    }

    return events;
  }

  private appendString(
    field: Exclude<SeoStreamFieldName, 'tags'>,
    text: string,
    close: boolean
  ): SeoFieldDeltaEvent[] {
    const max = SEO_FIELD_MAX[field];
    const room = max - this.assembled[field].length;
    const delta = room <= 0 || !text ? '' : text.slice(0, room);
    if (delta) this.assembled[field] += delta;
    if (!delta && !close) return [];
    return [{ field, delta, done: close }];
  }

  private appendTags(text: string, close: boolean): SeoFieldDeltaEvent[] {
    const events: SeoFieldDeltaEvent[] = [];
    this.tagCarry += text;

    if (!this.tagsJson && this.tagCarry.trimStart().startsWith('[')) {
      this.tagsJson = true;
    }

    if (this.tagsJson) {
      if (!close) return [];
      const jsonText = this.tagCarry.trim();
      this.tagCarry = '';
      try {
        events.push(...this.addTags(normalizeTags(JSON.parse(jsonText))));
      } catch {
        for (const line of jsonText.split(/\r?\n/)) {
          events.push(...this.addTags(normalizeTags(parseTagLine(line))));
        }
      }
      events.push({ field: 'tags', delta: '', done: true });
      return events;
    }

    const parts = this.tagCarry.split(/\r?\n/);
    if (!close) {
      this.tagCarry = parts.pop() ?? '';
    } else {
      this.tagCarry = '';
    }

    for (const line of parts) {
      events.push(...this.addTags(normalizeTags(parseTagLine(line))));
    }

    if (close) events.push({ field: 'tags', delta: '', done: true });
    return events;
  }

  private addTags(tags: string[]): SeoFieldDeltaEvent[] {
    const events: SeoFieldDeltaEvent[] = [];
    for (const tag of tags) {
      const key = tag.toLowerCase();
      if (this.seenTagKeys.has(key)) continue;
      if (this.assembled.tags.length >= MAX_TAGS) break;
      this.seenTagKeys.add(key);
      this.assembled.tags.push(tag);
      events.push({ field: 'tags', delta: tag, done: false });
    }
    return events;
  }
}

export function validateSeoAssembled(
  assembled: SeoAssembledFields
): SeoAssembledFields {
  const title = assembled.title.trim().slice(0, SEO_FIELD_MAX.title);
  const description = assembled.description
    .trim()
    .slice(0, SEO_FIELD_MAX.description);
  const mobileDetailMarkdown = assembled.mobileDetailMarkdown
    .trim()
    .slice(0, SEO_FIELD_MAX.mobileDetailMarkdown);
  const metaTitle = (
    assembled.metaTitle.trim() || title
  ).slice(0, SEO_FIELD_MAX.metaTitle);
  const metaDescription = (
    assembled.metaDescription.trim() || description.slice(0, 160)
  ).slice(0, SEO_FIELD_MAX.metaDescription);
  const tags = normalizeTags(assembled.tags);

  if (!title || !description || !mobileDetailMarkdown) {
    throw new SeoParseError(
      'GEMINI_INCOMPLETE',
      'AI omitted required copy fields.',
      'The AI left required fields empty. Please try again or switch model.'
    );
  }

  return {
    title,
    description,
    mobileDetailMarkdown,
    metaTitle,
    metaDescription,
    tags,
  };
}

function parseSeoJson(raw: string): SeoAssembledFields {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch {
    throw new SeoParseError(
      'GEMINI_INVALID_JSON',
      'AI returned invalid JSON.',
      'The AI response could not be parsed. Please try again or switch model.'
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SeoParseError(
      'GEMINI_INVALID_SHAPE',
      'AI returned unexpected JSON shape.',
      'The AI response was incomplete. Please try again or switch model.'
    );
  }

  const obj = parsed as Record<string, unknown>;
  return validateSeoAssembled({
    title: typeof obj.title === 'string' ? obj.title : '',
    description: typeof obj.description === 'string' ? obj.description : '',
    mobileDetailMarkdown:
      typeof obj.mobileDetailMarkdown === 'string'
        ? obj.mobileDetailMarkdown
        : typeof obj.mobile_detail_markdown === 'string'
          ? obj.mobile_detail_markdown
          : '',
    metaTitle:
      typeof obj.metaTitle === 'string'
        ? obj.metaTitle
        : typeof obj.meta_title === 'string'
          ? obj.meta_title
          : '',
    metaDescription:
      typeof obj.metaDescription === 'string'
        ? obj.metaDescription
        : typeof obj.meta_description === 'string'
          ? obj.meta_description
          : '',
    tags: normalizeTags(obj.tags),
  });
}

/**
 * Parse a complete model response: marked text first, JSON as fallback.
 */
export function parseSeoCopyText(raw: string): SeoAssembledFields {
  const trimmed = raw.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    throw new SeoParseError(
      'GEMINI_EMPTY',
      'Empty AI response.',
      'The AI returned no content. Try again or switch to another model.'
    );
  }

  const unfenced = stripCodeFences(trimmed);
  if (unfenced.startsWith('{')) {
    return parseSeoJson(unfenced);
  }

  const parser = new SeoMarkerStreamParser();
  parser.push(trimmed);
  parser.finish();

  if (parser.sawMarker) {
    return validateSeoAssembled(parser.assembled);
  }

  return parseSeoJson(trimmed);
}
