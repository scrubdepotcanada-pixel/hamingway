/**
 * Website SEO/AEO analyzer. Feeds a site snapshot to Claude and returns:
 *  - current keyword gaps / missed opportunities
 *  - AEO (AI Engine Optimization) readiness issues
 *  - 3 content ideas that would improve the site's search visibility
 *
 * The 3 ideas use the same GeneratedIdea shape so they slot straight into the
 * existing pipeline (content_ideas table → approval → create → review → publish).
 */

import { claudeJson } from './anthropic';
import type { SiteSnapshot } from '../web/fetch';
import type { GeneratedIdea } from './ideas';

export interface SiteAnalysis {
  summary: string;              // one-paragraph overview of the site
  current_strengths: string[];  // what the site does well
  seo_gaps: string[];           // keyword / on-page gaps
  aeo_gaps: string[];           // AI-search / featured-snippet gaps
  ideas: GeneratedIdea[];       // 3 content ideas to fill those gaps
}

export async function analyzeSiteAndGenerateIdeas(
  snapshot: SiteSnapshot,
  projectName?: string,
  projectVoice?: string,
): Promise<SiteAnalysis> {
  const system = [
    'You are Hemingway, a senior SEO, AEO, and content strategist for The Web Guys — a Vancouver-based AI/web agency.',
    'You are analyzing a live website to find content opportunities.',
    '',
    'SEO focus: identify missing long-tail keywords, thin content areas, untargeted buyer-intent queries, and pages that could rank with supporting blog content.',
    'AEO focus: check whether the site provides the clear, structured, concise answers that AI engines (ChatGPT, Perplexity, Google AI Overview) pull from. Look for missing FAQ schema, lack of question-format headings, and content that isn\'t formatted for featured snippets.',
    '',
    'Produce exactly 3 blog/content ideas that would improve the site\'s organic visibility AND its chances of being surfaced by AI search engines.',
    'Favor commercial-intent, long-tail keywords. Each idea should be something the site is NOT already covering well.',
    'Return valid JSON only — no prose, no markdown fences.',
  ].join(' ');

  const headingsBlock = snapshot.headings.length > 0
    ? snapshot.headings.join('\n')
    : '(no headings found)';

  const jsonLdBlock = snapshot.jsonLd.length > 0
    ? snapshot.jsonLd.join('\n---\n')
    : '(no structured data)';

  const ogBlock = Object.keys(snapshot.ogTags).length > 0
    ? Object.entries(snapshot.ogTags).map(([k, v]) => `${k}: ${v}`).join('\n')
    : '(no OG tags)';

  const user = [
    `=== SITE SNAPSHOT ===`,
    `URL: ${snapshot.url}`,
    `Title tag: ${snapshot.title || '(empty)'}`,
    `Meta description: ${snapshot.metaDescription || '(empty)'}`,
    `Meta keywords: ${snapshot.metaKeywords || '(none)'}`,
    ``,
    `--- OG tags ---`,
    ogBlock,
    ``,
    `--- Headings ---`,
    headingsBlock,
    ``,
    `--- JSON-LD structured data ---`,
    jsonLdBlock,
    ``,
    `--- Visible body text (first ~6000 chars) ---`,
    snapshot.bodyText || '(empty)',
    ``,
    `=== CONTEXT ===`,
    projectName ? `Project name: ${projectName}` : '',
    projectVoice ? `Desired brand voice: ${projectVoice}` : '',
    ``,
    `Return a JSON object with this exact shape:`,
    `{`,
    `  "summary": "one-paragraph description of the site and its niche",`,
    `  "current_strengths": ["strength 1", "strength 2", ...],`,
    `  "seo_gaps": ["gap 1", "gap 2", ...],`,
    `  "aeo_gaps": ["gap 1", "gap 2", ...],`,
    `  "ideas": [`,
    `    {`,
    `      "title": "Blog post title",`,
    `      "target_keyword": "primary keyword to target",`,
    `      "pitch": "2 sentences: what angle the post takes and why it fills a gap",`,
    `      "search_volume_rationale": "why this keyword has demand + relevance"`,
    `    },`,
    `    ... (exactly 3)`,
    `  ]`,
    `}`,
  ].filter(Boolean).join('\n');

  const result = await claudeJson<SiteAnalysis>({
    system,
    user,
    maxTokens: 4096,
  });

  if (!result.ideas || !Array.isArray(result.ideas) || result.ideas.length < 3) {
    throw new Error('Claude returned fewer than 3 ideas from site analysis');
  }
  result.ideas = result.ideas.slice(0, 3);
  return result;
}
