/**
 * Unsplash image search client.
 *
 * Free tier: 50 requests/hour. We request 3 queries per blog post so we can
 * fit ~16 posts/hour — well under the limit.
 *
 * Requires env var UNSPLASH_ACCESS_KEY. If not set, the module returns [] so
 * the pipeline degrades gracefully (post publishes without images).
 */

const UNSPLASH_API = 'https://api.unsplash.com';

export interface UnsplashImage {
  query: string;
  url: string;               // urls.regular
  urlSmall: string;          // urls.small
  alt: string;
  photographerName: string;
  photographerUrl: string;
  unsplashUrl: string;       // link to the photo page
}

interface UnsplashSearchResponse {
  results: Array<{
    id: string;
    alt_description: string | null;
    description: string | null;
    urls: { regular: string; small: string };
    links: { html: string };
    user: {
      name: string;
      username: string;
      links: { html: string };
    };
  }>;
}

const UTM = 'utm_source=hemingway&utm_medium=referral';

function appendUtm(url: string): string {
  if (!url) return url;
  return url.includes('?') ? `${url}&${UTM}` : `${url}?${UTM}`;
}

async function searchOne(query: string, accessKey: string): Promise<UnsplashImage | null> {
  const url = `${UNSPLASH_API}/search/photos?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape&content_filter=high`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
      'Accept-Version': 'v1',
    },
    // Unsplash responses are small; default timeout is fine.
  });
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as UnsplashSearchResponse;
  const top = data.results?.[0];
  if (!top) return null;
  return {
    query,
    url: top.urls.regular,
    urlSmall: top.urls.small,
    alt: top.alt_description ?? top.description ?? query,
    photographerName: top.user.name,
    photographerUrl: appendUtm(top.user.links.html),
    unsplashUrl: appendUtm(top.links.html),
  };
}

/**
 * Fetch one image per query. Queries that don't match anything are skipped.
 * Errors from Unsplash never bubble up — image fetch is best-effort.
 */
export async function fetchImagesForQueries(queries: string[]): Promise<UnsplashImage[]> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return [];
  if (!queries || queries.length === 0) return [];

  const results: UnsplashImage[] = [];
  for (const q of queries) {
    if (!q?.trim()) continue;
    try {
      const img = await searchOne(q.trim(), accessKey);
      if (img) results.push(img);
    } catch {
      // best-effort; skip this query
    }
  }
  return results;
}

/**
 * Render one image as a <figure> block matching Unsplash's required
 * attribution format.
 */
export function renderImageFigure(img: UnsplashImage): string {
  const alt = escapeHtmlAttr(img.alt || 'illustration');
  return [
    '<figure>',
    `  <img src="${img.url}" alt="${alt}" loading="lazy" />`,
    `  <figcaption>Photo by <a href="${img.photographerUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(img.photographerName)}</a> on <a href="https://unsplash.com/?${UTM}" target="_blank" rel="noopener noreferrer">Unsplash</a></figcaption>`,
    '</figure>',
  ].join('\n');
}

/**
 * Insert images into a body_html string at logical breakpoints: one image
 * after each closing </h2> tag, in order, until we run out of images.
 * If there are no H2 tags we prepend the first image and append the rest.
 */
export function insertImagesIntoBody(bodyHtml: string, images: UnsplashImage[]): string {
  if (!images || images.length === 0) return bodyHtml;
  if (!bodyHtml) return bodyHtml;

  const regex = /<\/h2>/gi;
  const matches: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(bodyHtml)) !== null) {
    matches.push(m.index + m[0].length);
  }

  if (matches.length === 0) {
    // no H2s — prepend the first image, drop the rest after the body
    return `${renderImageFigure(images[0])}\n${bodyHtml}${images
      .slice(1)
      .map(renderImageFigure)
      .join('\n')}`;
  }

  let result = '';
  let lastIdx = 0;
  let imgIdx = 0;
  for (const pos of matches) {
    result += bodyHtml.slice(lastIdx, pos);
    if (imgIdx < images.length) {
      result += `\n${renderImageFigure(images[imgIdx])}\n`;
      imgIdx++;
    }
    lastIdx = pos;
  }
  result += bodyHtml.slice(lastIdx);

  // If there are leftover images (rare), append at the end
  while (imgIdx < images.length) {
    result += `\n${renderImageFigure(images[imgIdx])}`;
    imgIdx++;
  }

  return result;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeHtmlAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
