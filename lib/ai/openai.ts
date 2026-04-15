import OpenAI from 'openai';

export const OPENAI_MODEL = 'gpt-4o-mini';

let _client: OpenAI | null = null;

export function openai(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  _client = new OpenAI({ apiKey });
  return _client;
}
