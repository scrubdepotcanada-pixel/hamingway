import type { Project } from '../db/schema';
import { claudeJson } from './anthropic';

export interface GeneratedIdea {
  title: string;
  target_keyword: string;
  pitch: string;
  search_volume_rationale: string;
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

export async function generateIdeas(project: Project): Promise<GeneratedIdea[]> {
  const cfg = parseConfig(project);
  const keywords = (cfg.keywords ?? []).join(', ');

  const system = [
    'You are Hemingway, an SEO and content strategist for The Web Guys (Vancouver AI/web agency).',
    'Generate exactly 3 blog content ideas tailored to the brand and audience.',
    'Ideas should have realistic organic search demand and align with the brand voice.',
    'Favor long-tail, commercial-intent keywords over broad head terms.',
    'Return valid JSON only — no prose, no markdown fences.',
  ].join(' ');

  const user = [
    `Brand: ${project.name}`,
    `Domain: ${project.domain ?? 'n/a'}`,
    `Industry: ${cfg.industry ?? 'n/a'}`,
    `Voice: ${cfg.voice ?? 'n/a'}`,
    `Priority keywords: ${keywords || 'n/a'}`,
    '',
    'Return a JSON object with the shape:',
    '{"ideas": [',
    '  { "title": "...", "target_keyword": "...", "pitch": "2 sentences describing the angle and why it will rank", "search_volume_rationale": "brief note about intent + volume" },',
    '  ... (3 total)',
    ']}',
  ].join('\n');

  const result = await claudeJson<{ ideas: GeneratedIdea[] }>({
    system,
    user,
    maxTokens: 2048,
  });

  if (!result.ideas || !Array.isArray(result.ideas) || result.ideas.length < 3) {
    throw new Error('Claude returned fewer than 3 ideas');
  }

  return result.ideas.slice(0, 3);
}
