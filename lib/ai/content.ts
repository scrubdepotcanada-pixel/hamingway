import type { ContentIdea, Project } from '../db/schema';
import { claudeJson } from './anthropic';

export interface GeneratedContent {
  title: string;
  slug: string;
  meta_description: string;
  body_html: string;
  excerpt: string;
  social_linkedin: string;
  social_twitter: string;
  social_facebook: string;
  social_instagram: string;
  image_queries: string[];
}

export type ReviewVerdict = 'accept' | 'reject' | 'modify';

export interface ReviewDecision {
  suggestion: string;
  verdict: ReviewVerdict;
  reasoning: string;
}

export interface RevisedContentResult {
  decisions: ReviewDecision[];
  revised_draft: GeneratedContent;
}

interface ProjectConfig {
  industry?: string;
  voice?: string;
  keywords?: string[];
}

function parseConfig(p: Project): ProjectConfig {
  try {
    return JSON.parse(p.config ?? '{}') as ProjectConfig;
  } catch {
    return {};
  }
}

export async function generateContent(
  project: Project,
  idea: ContentIdea,
): Promise<GeneratedContent> {
  const cfg = parseConfig(project);

  const system = [
    'You are Hemingway, a senior content writer for The Web Guys.',
    'Write SEO-optimized blog posts and matching social variants.',
    'Write in the requested brand voice. Use natural prose — no fluff, no cliché openers.',
    'HTML output must use semantic tags: <h2>, <h3>, <p>, <ul>, <li>, <strong>, <a href>.',
    'Do NOT include <html>, <head>, <body>, or <h1> tags — the title is rendered separately.',
    'Do NOT include any <img> or <figure> tags — images are inserted by the pipeline after you respond.',
    'Return valid JSON only.',
  ].join(' ');

  const user = [
    `Brand: ${project.name}`,
    `Domain: ${project.domain ?? 'n/a'}`,
    `Industry: ${cfg.industry ?? 'n/a'}`,
    `Voice: ${cfg.voice ?? 'n/a'}`,
    `Priority keywords: ${(cfg.keywords ?? []).join(', ')}`,
    '',
    `Selected idea:`,
    `  Title: ${idea.title}`,
    `  Target keyword: ${idea.targetKeyword ?? 'n/a'}`,
    `  Angle: ${idea.pitch ?? 'n/a'}`,
    '',
    'Requirements:',
    '- body_html: 800-1200 words, structured with H2/H3. Natural keyword density 1-2%. No <h1>, no <img>.',
    '- meta_description: 150-160 characters, compelling, includes target keyword naturally.',
    '- slug: lowercase, hyphenated, max 60 chars.',
    '- excerpt: 1-2 sentences, ~160 chars.',
    '- social_linkedin: up to 3000 chars, first line must be a hook (no link), use line breaks.',
    '- social_twitter: max 280 chars, include 1-2 relevant hashtags.',
    '- social_facebook: max 500 chars, friendly tone, 1 hashtag max.',
    '- social_instagram: max 2200 chars, include 5-10 relevant hashtags at the end.',
    '- image_queries: array of 2-3 short, specific image-search queries that would find relevant stock photos. Use concrete descriptive terms (people, objects, settings) — NOT abstract concepts. Each query should be 2-5 words. Example good: "nurse uniform hospital ward", "medical scrubs folded". Example bad: "healthcare", "professionalism".',
    '',
    'Return JSON with this exact shape:',
    '{',
    '  "title": "...",',
    '  "slug": "...",',
    '  "meta_description": "...",',
    '  "body_html": "...",',
    '  "excerpt": "...",',
    '  "social_linkedin": "...",',
    '  "social_twitter": "...",',
    '  "social_facebook": "...",',
    '  "social_instagram": "...",',
    '  "image_queries": ["...", "...", "..."]',
    '}',
  ].join('\n');

  const result = await claudeJson<GeneratedContent>({
    system,
    user,
    maxTokens: 6000,
  });
  // Defensive default if Claude skips the field.
  if (!Array.isArray(result.image_queries)) {
    result.image_queries = [];
  }
  return result;
}

/**
 * Revise content by having Claude evaluate each of GPT's suggestions
 * individually (accept / reject / modify with reasoning), then produce a
 * revised draft incorporating only the accepted/modified changes.
 *
 * Returns both the decisions and the revised draft in a single LLM call so
 * we keep the step under the serverless timeout.
 */
export async function reviseContent(
  project: Project,
  idea: ContentIdea,
  previous: GeneratedContent,
  review: {
    scores?: Record<string, number>;
    issues?: string[];
    suggestions?: string[];
    needs_revision?: boolean;
  },
): Promise<RevisedContentResult> {
  const cfg = parseConfig(project);

  const system = [
    'You are Hemingway, a senior editor doing a revision pass.',
    'An independent reviewer (GPT) has flagged issues and proposed suggestions.',
    'Evaluate EACH suggestion individually. Accept suggestions that genuinely improve quality, SEO, accuracy, or brand voice.',
    'Reject suggestions that would make the content generic, remove personality, flatten the brand voice, or are stylistic preferences rather than real improvements.',
    'Use the "modify" verdict when the suggestion has a valid point but needs to be applied differently.',
    'Then produce a revised draft incorporating only the accepted/modified changes. Preserve what was already working.',
    'Return valid JSON only, in the exact shape specified.',
  ].join(' ');

  const issues = review.issues ?? [];
  const suggestions = review.suggestions ?? [];

  const user = [
    `Brand: ${project.name}`,
    `Voice: ${cfg.voice ?? 'n/a'}`,
    `Target keyword: ${idea.targetKeyword ?? 'n/a'}`,
    '',
    'Reviewer scores:',
    JSON.stringify(review.scores ?? {}, null, 2),
    '',
    'Reviewer issues:',
    issues.length > 0 ? issues.map((s, i) => `  ${i + 1}. ${s}`).join('\n') : '  (none)',
    '',
    'Reviewer suggestions (evaluate each):',
    suggestions.length > 0 ? suggestions.map((s, i) => `  ${i + 1}. ${s}`).join('\n') : '  (none)',
    '',
    'Previous draft (JSON):',
    JSON.stringify(previous, null, 2),
    '',
    'Return a JSON object with this exact shape:',
    '{',
    '  "decisions": [',
    '    { "suggestion": "verbatim text of the suggestion being evaluated", "verdict": "accept"|"reject"|"modify", "reasoning": "one-sentence explanation" }',
    '  ],',
    '  "revised_draft": {',
    '    "title": "...", "slug": "...", "meta_description": "...", "body_html": "...", "excerpt": "...",',
    '    "social_linkedin": "...", "social_twitter": "...", "social_facebook": "...", "social_instagram": "...",',
    '    "image_queries": ["...", "..."]',
    '  }',
    '}',
    '',
    'If the suggestions list is empty but issues exist, still produce a revised_draft addressing those issues and note in decisions that it was driven by issues not suggestions.',
    'If there is nothing substantive to change, return the previous draft unchanged in revised_draft and explain in decisions.',
  ].join('\n');

  const result = await claudeJson<RevisedContentResult>({
    system,
    user,
    maxTokens: 6000,
  });
  if (!result.revised_draft) {
    throw new Error('Revision response missing revised_draft');
  }
  if (!Array.isArray(result.revised_draft.image_queries)) {
    result.revised_draft.image_queries = previous.image_queries ?? [];
  }
  if (!Array.isArray(result.decisions)) {
    result.decisions = [];
  }
  return result;
}
