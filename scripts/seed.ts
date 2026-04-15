/**
 * Seed rotation projects. Idempotent — updates existing rows by name.
 * Run with:  pnpm tsx scripts/seed.ts
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';
import { v4 as uuid } from 'uuid';

type SeedProject = {
  name: string;
  domain: string;
  rotationOrder: number;
  platforms: string[];
  config: {
    industry: string;
    voice: string;
    keywords: string[];
  };
};

const SEEDS: SeedProject[] = [
  {
    name: 'Scrub Depot',
    domain: 'scrubdepot.ca',
    rotationOrder: 1,
    platforms: ['blog', 'facebook', 'instagram'],
    config: {
      industry: 'medical scrubs and uniforms',
      voice: 'professional but approachable, practical',
      keywords: [
        'medical scrubs Canada',
        'nursing uniforms Vancouver',
        'healthcare workwear',
      ],
    },
  },
  {
    name: 'Nursing Shoes',
    domain: 'nursingshoes.ca',
    rotationOrder: 2,
    platforms: ['blog', 'facebook', 'instagram'],
    config: {
      industry: 'nursing and healthcare footwear',
      voice: 'caring, expert, comfort-focused',
      keywords: [
        'nursing shoes Canada',
        'comfortable healthcare shoes',
        'slip-resistant nursing footwear',
      ],
    },
  },
  {
    name: 'The Web Guys',
    domain: 'thewebguys.ca',
    rotationOrder: 3,
    platforms: ['blog', 'linkedin', 'twitter'],
    config: {
      industry: 'AI-powered ecommerce tools and web development',
      voice: 'technical but accessible, innovative, confident',
      keywords: [
        'AI ecommerce tools',
        'AI chatbot for ecommerce',
        'AI size recommendation',
      ],
    },
  },
  {
    name: 'Size Agent / Stitch',
    domain: 'thewebguys.ca/stitch',
    rotationOrder: 4,
    platforms: ['blog', 'linkedin', 'twitter'],
    config: {
      industry: 'AI size recommendation for online apparel',
      voice: 'data-driven, reducing returns, improving fit',
      keywords: [
        'AI size chart',
        'reduce ecommerce returns',
        'virtual fitting room',
      ],
    },
  },
];

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL is not set');

  const client = createClient({ url, authToken });

  for (const p of SEEDS) {
    const existing = await client.execute({
      sql: 'SELECT id FROM projects WHERE name = ?',
      args: [p.name],
    });

    const platformsJson = JSON.stringify(p.platforms);
    const configJson = JSON.stringify(p.config);

    if (existing.rows.length > 0) {
      const id = existing.rows[0].id as string;
      await client.execute({
        sql: `UPDATE projects
              SET domain = ?, rotation_order = ?, platforms = ?, config = ?, is_active = 1
              WHERE id = ?`,
        args: [p.domain, p.rotationOrder, platformsJson, configJson, id],
      });
      console.log(`Updated ${p.name}`);
    } else {
      await client.execute({
        sql: `INSERT INTO projects (id, name, domain, rotation_order, platforms, config, is_active)
              VALUES (?, ?, ?, ?, ?, ?, 1)`,
        args: [uuid(), p.name, p.domain, p.rotationOrder, platformsJson, configJson],
      });
      console.log(`Inserted ${p.name}`);
    }
  }

  // Ensure singleton schedule_state row exists
  await client.execute({
    sql: `INSERT OR IGNORE INTO schedule_state (id, current_step) VALUES ('singleton', 'IDLE')`,
    args: [],
  });

  console.log('Seed complete.');
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
