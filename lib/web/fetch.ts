/**
 * Lightweight website fetcher. Grabs a page's HTML and extracts the
 * information Claude needs to do an SEO/AEO analysis:
 *  - title tag
 *  - meta description
 *  - meta keywords
 *  - all heading text (h1-h6)
 *  - visible body text (truncated to ~6000 chars to stay prompt-friendly)
 *  - structured data (JSON-LD) snippets
 *
 * Runs entirely on the serverless function — no browser needed.
 */

export interface SiteSnapshot {
  url: string;
  title: string;
  metaDescription: string;
  metaKeywords: string;
  headings: string[];
  bodyText: string;
  jsonLd: string[];
  ogTags: Record<string, string>;
  fetchedAt: string;
}

export async function fetchSiteSnapshot(url: string): Promise<SiteSnapshot> {
  // Normalize URL
  let normalized = url.trim();
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  const res = await fetch(normalized, {
    headers: {
      'User-Agent': 'HemingwayBot/1.0 (content auditor for thewebguys.ca)',
      Accept: 'text/html',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`Fetch ${normalized} returned ${res.status}`);
  }

  const html = await res.text();

  return {
    url: normalized,
    title: extractTag(html, 'title'),
    metaDescription: extractMeta(html, 'description'),
    metaKeywords: extractMeta(html, 'keywords'),
    headings: extractHeadings(html),
    bodyText: extractBodyText(html).slice(0, 6000),
    jsonLd: extractJsonLd(html),
    ogTags: extractOgTags(html),
    fetchedAt: new Date().toISOString(),
  };
}

function extractTag(html: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = html.match(re);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function extractMeta(html: string, name: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`,
    'i',
  );
  const m = html.match(re);
  if (m) return m[1].trim();
  // try reversed attribute order
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["']`,
    'i',
  );
  const m2 = html.match(re2);
  return m2 ? m2[1].trim() : '';
}

function extractHeadings(html: string): string[] {
  const results: string[] = [];
  const re = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) results.push(`${m[1].toUpperCase()}: ${text}`);
  }
  return results.slice(0, 30);
}

function extractBodyText(html: string): string {
  let body = html;
  // strip scripts, styles, head
  body = body.replace(/<head[\s\S]*?<\/head>/gi, '');
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  body = body.replace(/<style[\s\S]*?<\/style>/gi, '');
  body = body.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  body = body.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  // strip tags
  body = body.replace(/<[^>]+>/g, ' ');
  // collapse whitespace
  body = body.replace(/\s+/g, ' ').trim();
  // decode common entities
  body = body
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"');
  return body;
}

function extractJsonLd(html: string): string[] {
  const results: string[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = m[1].trim();
    if (text) results.push(text.slice(0, 2000)); // cap per snippet
  }
  return results.slice(0, 5);
}

function extractOgTags(html: string): Record<string, string> {
  const tags: Record<string, string> = {};
  const re = /<meta[^>]+property=["'](og:[^"']*)["'][^>]+content=["']([^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    tags[m[1]] = m[2];
  }
  return tags;
}
