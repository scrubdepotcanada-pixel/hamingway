import { OPENAI_MODEL, openai } from './openai';
import type { GeneratedContent } from './content';
import type { Project, ContentIdea } from '../db/schema';

export interface ReviewResult {
  scores: {
    seo: number;
    quality: number;
    coherence: number;
    eeat: number;
    overall: number;
  };
  issues: string[];
  suggestions: string[];
  needs_revision: boolean;
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

export async function reviewContent(
  project: Project,
  idea: ContentIdea,
  draft: GeneratedContent,
): Promise<ReviewResult> {
  const cfg = parseConfig(project);

  const system = [
    'You are an independent SEO and content editor reviewing a blog draft.',
    'Score it on SEO, quality, coherence, and E-E-A-T (each 1-10).',
    'Flag real issues — do not invent problems where there are none.',
    'Return JSON only.',
  ].join(' ');

  const user = [
    `Brand: ${project.name}`,
    `Industry: ${cfg.industry ?? 'n/a'}`,
    `Expected voice: ${cfg.voice ?? 'n/a'}`,
    `Target keyword: ${idea.targetKeyword ?? 'n/a'}`,
    '',
    'Draft to review (JSON):',
    JSON.stringify(draft, null, 2),
    '',
    'Return a JSON object with this shape:',
    '{',
    '  "scores": { "seo": 1-10, "quality": 1-10, "coherence": 1-10, "eeat": 1-10, "overall": 1-10 },',
    '  "issues": ["specific issue strings"],',
    '  "suggestions": ["concrete rewrite suggestions"],',
    '  "needs_revision": true|false',
    '}',
    '',
    'Set needs_revision=true if overall < 7 OR if there are critical SEO/accuracy/brand-voice issues.',
  ].join('\n');

  const response = await openai().chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const text = response.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(text) as ReviewResult;
  if (!parsed.scores) throw new Error('OpenAI review missing scores');
  return parsed;
}
