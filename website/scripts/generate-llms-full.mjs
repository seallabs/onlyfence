#!/usr/bin/env node
/**
 * Generates static/llms-full.txt by concatenating all docs markdown.
 * Run: node scripts/generate-llms-full.mjs
 *
 * The output follows the llms-full.txt convention: a single markdown file
 * containing the full documentation, consumable by LLMs in one fetch.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const DOCS_DIR = new URL('../docs', import.meta.url).pathname;
const OUT_FILE = new URL('../static/llms-full.txt', import.meta.url).pathname;

/** Recursively collect all .md files in a directory. */
async function collectMarkdown(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMarkdown(full));
    } else if (entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

/** Strip YAML frontmatter from markdown content. */
function stripFrontmatter(content) {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('---', 3);
  if (end === -1) return content;
  return content.slice(end + 3).trimStart();
}

/** Strip MDX import/JSX blocks (like <Head> with JSON-LD) that aren't readable text. */
function stripMdxBlocks(content) {
  return content
    .replace(/^import\s+.*$/gm, '')
    .replace(/<Head>[\s\S]*?<\/Head>/g, '')
    .trim();
}

async function main() {
  const files = (await collectMarkdown(DOCS_DIR)).sort();

  const header = [
    '# OnlyFence — Full Documentation',
    '',
    '> OnlyFence is a free, open-source CLI tool that gives AI agents safe access to DeFi.',
    '> It enforces spending limits, token allowlists, and security policies before any transaction is signed.',
    '> Website: https://onlyfence.xyz | GitHub: https://github.com/seallabs/onlyfence',
    '',
    '---',
    '',
  ].join('\n');

  const sections = [];
  for (const file of files) {
    const raw = await readFile(file, 'utf-8');
    const cleaned = stripMdxBlocks(stripFrontmatter(raw));
    const relPath = relative(DOCS_DIR, file);
    sections.push(`<!-- source: docs/${relPath} -->\n\n${cleaned}`);
  }

  const output = header + sections.join('\n\n---\n\n') + '\n';
  await writeFile(OUT_FILE, output, 'utf-8');

  const sizeKb = (Buffer.byteLength(output, 'utf-8') / 1024).toFixed(1);
  console.log(`Generated ${OUT_FILE} (${sizeKb} KB, ${files.length} docs)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
