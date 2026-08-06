import { markdownToHtml } from '../../add/import-wizard-utils';
import type { ProductPayload } from '../../manage/utils';

/**
 * Convert stored product HTML back into Markdown for the MD editor.
 * Best-effort: handles common tags produced by marked / storefront HTML.
 */
export function htmlToMarkdown(html: string | null | undefined): string {
  const raw = (html ?? '').trim();
  if (!raw) return '';

  // Already looks like markdown / plain text with no tags
  if (!/<[a-z][\s\S]*>/i.test(raw)) return raw;

  try {
    if (typeof DOMParser === 'undefined') {
      return stripTagsFallback(raw);
    }

    const doc = new DOMParser().parseFromString(
      `<div id="root">${raw}</div>`,
      'text/html'
    );
    const root = doc.getElementById('root');
    if (!root) return stripTagsFallback(raw);

    return serializeNode(root).trim().replace(/\n{3,}/g, '\n\n');
  } catch {
    return stripTagsFallback(raw);
  }
}

function stripTagsFallback(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\s+/g, ' ');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map(serializeNode).join('');

  switch (tag) {
    case 'br':
      return '\n';
    case 'strong':
    case 'b':
      return children.trim() ? `**${children.trim()}**` : '';
    case 'em':
    case 'i':
      return children.trim() ? `*${children.trim()}*` : '';
    case 'code':
      return children.trim() ? `\`${children.trim()}\`` : '';
    case 'a': {
      const href = el.getAttribute('href') ?? '';
      const text = children.trim() || href;
      return href ? `[${text}](${href})` : text;
    }
    case 'img': {
      const src = el.getAttribute('src') ?? '';
      const alt = el.getAttribute('alt') ?? '';
      return src ? `![${alt}](${src})` : '';
    }
    case 'h1':
      return `\n# ${children.trim()}\n\n`;
    case 'h2':
      return `\n## ${children.trim()}\n\n`;
    case 'h3':
      return `\n### ${children.trim()}\n\n`;
    case 'h4':
      return `\n#### ${children.trim()}\n\n`;
    case 'h5':
      return `\n##### ${children.trim()}\n\n`;
    case 'h6':
      return `\n###### ${children.trim()}\n\n`;
    case 'p':
      return `\n\n${children.trim()}\n\n`;
    case 'li':
      return `\n- ${children.trim()}`;
    case 'ul':
    case 'ol':
      return `\n${children}\n`;
    case 'blockquote':
      return `\n> ${children.trim().replace(/\n/g, '\n> ')}\n\n`;
    case 'pre':
      return `\n\`\`\`\n${(el.textContent ?? '').trim()}\n\`\`\`\n\n`;
    case 'hr':
      return '\n\n---\n\n';
    case 'div':
    case 'span':
    case 'section':
    case 'article':
      return children;
    default:
      return children;
  }
}

export { markdownToHtml };

/** Stable snapshot for dirty-checking the edit form. */
export function serializeFormSnapshot(
  form: ProductPayload,
  markdown: string
): string {
  return JSON.stringify({
    name: form.name,
    description: form.description,
    mobileDetailMarkdown: markdown,
    hasSizeChart: form.hasSizeChart,
    sizeChartImage: form.sizeChartImage,
    sizeChartDescription: form.sizeChartDescription,
    images: form.images,
    videos: form.videos,
    mainVideo: form.mainVideo,
    categoryIds: [...form.categoryIds].sort(),
    published: form.published,
    featured: form.featured,
    metaTitle: form.metaTitle,
    metaDescription: form.metaDescription,
    tags: form.tags,
    productNotes: form.productNotes,
    skus: form.skus.map((sku) => ({
      aeSkuId: sku.aeSkuId,
      price: sku.price,
      compareAtPrice: sku.compareAtPrice,
      stock: sku.stock,
      sku: sku.sku,
      properties: sku.properties,
      images: sku.images,
    })),
    attributes: form.attributes.map((a) => ({
      attrName: a.attrName,
      attrValue: a.attrValue,
      attrValueUnit: a.attrValueUnit,
    })),
  });
}

export function imageDedupeKey(url: string): string {
  try {
    const parsed = new URL(url, 'https://mantomart.com');
    const pathname = parsed.pathname.replace(
      /\.(jpe?g|png|webp|gif)(?:_.+)$/i,
      '.$1'
    );
    const host = parsed.host.toLowerCase();
    return host ? `${host}${pathname}` : pathname;
  } catch {
    return url.replace(/#.*$/, '').replace(/\?.*$/, '');
  }
}
