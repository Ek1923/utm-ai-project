import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const NEXUS_ROOT  = path.resolve(__dirname, '../../..');      // nexus/
const PROJECT_ROOT = path.resolve(__dirname, '../../../..'); // utm_AI_Project/

const CODE_EXTS   = new Set(['.ts', '.tsx', '.py', '.js', '.jsx', '.json', '.md', '.css']);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.vite', 'coverage']);
const MAX_FILE_CHARS   = 2500;
const MAX_FILES_IN_CTX = 4;
const INDEX_TTL        = 30_000; // re-scan every 30s

interface FileEntry {
  relPath: string;
  content:  string;
  tokens:   Set<string>;
}

let _index:       FileEntry[] = [];
let _indexedAt    = 0;

// ── Local file indexing ──────────────────────────────────────────────────────

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\W+/).filter(w => w.length > 2));
}

function walkDir(dir: string, entries: FileEntry[]): void {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return; }

  for (const name of names) {
    if (IGNORE_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    let stat: fs.Stats;
    try { stat = fs.statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      walkDir(full, entries);
    } else if (CODE_EXTS.has(path.extname(name))) {
      try {
        const raw     = fs.readFileSync(full, 'utf-8');
        const content = raw.slice(0, MAX_FILE_CHARS);
        const relPath = path.relative(PROJECT_ROOT, full).replace(/\\/g, '/');
        entries.push({ relPath, content, tokens: tokenize(relPath + ' ' + content) });
      } catch { /* skip unreadable */ }
    }
  }
}

function refreshIndex(): void {
  const now = Date.now();
  if (now - _indexedAt < INDEX_TTL) return;
  const entries: FileEntry[] = [];
  walkDir(NEXUS_ROOT, entries);
  _index     = entries;
  _indexedAt = now;
}

function scoreEntry(entry: FileEntry, queryTokens: Set<string>): number {
  let score = 0;
  for (const t of queryTokens) {
    if (entry.tokens.has(t)) {
      // Path hits count more
      score += entry.relPath.toLowerCase().includes(t) ? 4 : 1;
    }
  }
  return score;
}

export function getLocalContext(query: string): string {
  refreshIndex();

  const qTokens = tokenize(query);
  const scored  = _index
    .map(e  => ({ e, score: scoreEntry(e, qTokens) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FILES_IN_CTX);

  if (!scored.length) return '';

  const sections = scored.map(({ e }) =>
    `\`\`\`\n// ${e.relPath}\n${e.content}${e.content.length >= MAX_FILE_CHARS ? '\n// ... (truncated)' : ''}\n\`\`\``
  );

  return `[NEXUS PROJECT FILES — meest relevant voor jouw vraag]\n\n${sections.join('\n\n')}`;
}

export function getIndexStats(): { files: number; indexedAt: number } {
  return { files: _index.length, indexedAt: _indexedAt };
}

// ── GitHub context ────────────────────────────────────────────────────────────

const GITHUB_API = 'https://api.github.com';

function githubHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'NEXUS-FORGE' };
  if (token) h.Authorization = `token ${token}`;
  return h;
}

export async function searchGitHub(query: string, token?: string): Promise<string> {
  const headers = githubHeaders(token);

  // Build a tighter search query: extract meaningful keywords
  const keywords = query
    .replace(/['"()?!.]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !/^(how|what|can|does|make|want|need|that|this|with|from|have|will|voor|naar|een|dat|die|hoe|wat|kan|wil|moet|zijn|heeft)$/i.test(w))
    .slice(0, 5)
    .join(' ');

  if (!keywords) return '';

  try {
    const searchRes = await axios.get(`${GITHUB_API}/search/code`, {
      params: { q: `${keywords} language:typescript OR language:python`, per_page: 5 },
      headers,
      timeout: 8000,
    });

    const items: any[] = searchRes.data.items ?? [];
    const results: string[] = [];

    for (const item of items.slice(0, 3)) {
      try {
        const fileRes = await axios.get(item.url, { headers, timeout: 5000 });
        const content = Buffer.from(fileRes.data.content ?? '', 'base64')
          .toString('utf-8')
          .slice(0, 1800);
        results.push(
          `\`\`\`\n// GitHub: ${item.repository.full_name} → ${item.path}\n${content}\n\`\`\``
        );
      } catch { /* skip file if fetch fails */ }
    }

    if (!results.length) return '';
    return `[GITHUB CODE VOORBEELDEN]\n\n${results.join('\n\n')}`;
  } catch {
    return '';
  }
}

// ── Combined FORGE context builder ────────────────────────────────────────────

const GITHUB_TRIGGERS = /github|npm package|open.?source|library|framework|how.*implement|example.*of|hoe.*bouw|voorbeeld.*van|zoek.*op github/i;

export async function buildForgeContext(query: string, githubToken?: string): Promise<string> {
  const localCtx = getLocalContext(query);

  const wantsGitHub = GITHUB_TRIGGERS.test(query);
  const githubCtx   = wantsGitHub ? await searchGitHub(query, githubToken) : '';

  const parts = [localCtx, githubCtx].filter(Boolean);
  return parts.length ? '\n\n' + parts.join('\n\n') : '';
}
