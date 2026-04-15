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
    '- body_html: 800-1200 words, structured with H2/H3. Natural keyword density 1-2%. No <h1>.',
    '- meta_description: 150-160 characters, compelling, includes target keyword naturally.',
    '- slug: lowercase, hyphenated, max 60 chars.',
    '- excerpt: 1-2 sentences, ~160 chars.',
    '- social_linkedin: up to 3000 chars, first line must be a hook (no link), use line breaks.',
    '- social_twitter: max 280 chars, include 1-2 relevant hashtags.',
    '- social_facebook: max 500 chars, friendly tone, 1 hashtag max.',
    '- social_instagram: max 2200 chars, include 5-10 relevant hashtags at the end.',
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
    '  "social_instagram": "..."',
    '}',
  ].join('\n');

  return claudeJson<GeneratedContent>({
    system,
    user,
    maxTokens: 6000,
  });
}

export async function reviseContent(
  project: Project,
  idea: ContentIdea,
  previous: GeneratedContent,
  reviewFeedback: unknown,
): Promise<GeneratedContent> {
  const cfg = parseConfig(project);

  const system = [
    'You are Hemingway, a senior content writer doing a revision pass.',
    'You received review feedback from an independent editor (GPT).',
    'Address the issues raised, BUT use your judgment — reject suggestions that would harm quality, clarity, or voice.',
    'Preserve what is already working. Improve what is not.',
    'Return valid JSON in the same shape as the original draft.',
  ].join(' ');

  const user = [
    `Brand: ${project.name}`,
    `Voice: ${cfg.voice ?? 'n/a'}`,
    `Target keyword: ${idea.targetKeyword ?? 'n/a'}`,
    '',
    'Reviewer feedback (JSON):',
    typeof reviewFeedback === 'string' ? reviewFeedback : JSON.stringify(reviewFeedback, null, 2),
    '',
    'Previous draft (JSON):',
    JSON.stringify(previous, null, 2),
    '',
    'Return a revised draft as a JSON object with the same keys as the previous draft.',
  ].join('\n');

  return claudeJson<GeneratedContent>({
    system,
    user,
    maxTokens: 6000,
  });
}
