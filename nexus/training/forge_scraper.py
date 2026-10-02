"""
FORGE Data Scraper
Haalt training data op van GitHub voor alle populaire programmeertalen.
Geen API key nodig voor publieke repos (60 req/hr zonder, 5000/hr met token).

Gebruik:
  python forge_scraper.py                        # standaard (10.000 samples)
  python forge_scraper.py --token ghp_xxxxx      # met GitHub token (sneller)
  python forge_scraper.py --target 50000         # meer samples
  python forge_scraper.py --lang python rust     # specifieke talen
"""

import os
import json
import time
import hashlib
import argparse
import urllib.request
import urllib.parse
from pathlib import Path

# ─── Config ───────────────────────────────────────────────────────────────────

GITHUB_TOKEN   = os.environ.get('GITHUB_TOKEN', '')
OUTPUT_DIR     = Path(__file__).parent / 'data'
SAMPLES_FILE   = OUTPUT_DIR / 'forge_samples.jsonl'
SEEN_FILE      = OUTPUT_DIR / 'seen_hashes.txt'
MIN_STARS      = 100
MAX_FILE_BYTES = 40_000
TARGET_SAMPLES = 10_000

# Alle populaire talen + bijbehorende bestandsextensies
LANGUAGES = {
    'typescript': {
        'extensions': {'.ts', '.tsx', '.mts', '.cts'},
        'queries': [
            'language:TypeScript stars:>200 topic:react',
            'language:TypeScript stars:>200 topic:nodejs',
            'language:TypeScript stars:>100 topic:api',
            'language:TypeScript stars:>100 topic:cli',
        ],
    },
    'javascript': {
        'extensions': {'.js', '.mjs', '.cjs'},
        'queries': [
            'language:JavaScript stars:>200 topic:nodejs',
            'language:JavaScript stars:>200 topic:express',
            'language:JavaScript stars:>100 topic:react',
        ],
    },
    'python': {
        'extensions': {'.py'},
        'queries': [
            'language:Python stars:>500 topic:machine-learning',
            'language:Python stars:>300 topic:api',
            'language:Python stars:>200 topic:cli',
            'language:Python stars:>300 topic:data-science',
        ],
    },
    'cpp': {
        'extensions': {'.cpp', '.cxx', '.cc', '.hpp', '.hxx', '.h'},
        'queries': [
            'language:C++ stars:>500',
            'language:C++ stars:>200 topic:game-engine',
            'language:C++ stars:>200 topic:systems-programming',
            'language:C++ stars:>300 topic:networking',
        ],
    },
    'c': {
        'extensions': {'.c', '.h'},
        'queries': [
            'language:C stars:>500 topic:operating-system',
            'language:C stars:>300 topic:embedded',
            'language:C stars:>500 topic:networking',
        ],
    },
    'rust': {
        'extensions': {'.rs'},
        'queries': [
            'language:Rust stars:>300',
            'language:Rust stars:>200 topic:systems-programming',
            'language:Rust stars:>200 topic:webassembly',
        ],
    },
    'go': {
        'extensions': {'.go'},
        'queries': [
            'language:Go stars:>300 topic:api',
            'language:Go stars:>200 topic:microservices',
            'language:Go stars:>300 topic:cli',
        ],
    },
    'java': {
        'extensions': {'.java'},
        'queries': [
            'language:Java stars:>300 topic:spring',
            'language:Java stars:>200 topic:android',
            'language:Java stars:>300 topic:api',
        ],
    },
    'csharp': {
        'extensions': {'.cs'},
        'queries': [
            'language:C# stars:>300 topic:dotnet',
            'language:C# stars:>200 topic:unity',
            'language:C# stars:>200 topic:api',
        ],
    },
    'swift': {
        'extensions': {'.swift'},
        'queries': [
            'language:Swift stars:>200 topic:ios',
            'language:Swift stars:>200 topic:swiftui',
        ],
    },
    'kotlin': {
        'extensions': {'.kt', '.kts'},
        'queries': [
            'language:Kotlin stars:>200 topic:android',
            'language:Kotlin stars:>200 topic:spring',
        ],
    },
    'zig': {
        'extensions': {'.zig'},
        'queries': [
            'language:Zig stars:>100',
        ],
    },
}

SKIP_DIRS = {'node_modules', '.git', 'dist', 'build', 'coverage', '__tests__',
             '.next', 'vendor', 'third_party', 'deps', 'pkg', 'target'}

# ─── GitHub API helper ────────────────────────────────────────────────────────

def gh_get(url: str):
    headers = {
        'Accept':     'application/vnd.github+json',
        'User-Agent': 'FORGE-Scraper/1.0',
    }
    if GITHUB_TOKEN:
        headers['Authorization'] = f'Bearer {GITHUB_TOKEN}'

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 403:
            wait = 60 if not GITHUB_TOKEN else 15
            print(f'  [rate limit] wachten {wait}s...')
            time.sleep(wait)
        elif e.code not in (404, 451):
            print(f'  [HTTP {e.code}] {url[:80]}')
    except Exception as e:
        print(f'  [fout] {e}')
    return None


def fetch_raw(url: str) -> str | None:
    if not url:
        return None
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'FORGE-Scraper/1.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.read().decode('utf-8', errors='ignore')
    except Exception:
        return None

# ─── Code → instruction pairs ────────────────────────────────────────────────

def extract_function_blocks(content: str, lang: str) -> list[str]:
    """Simpele extractie van function/class blokken per taal."""
    lines  = content.splitlines()
    blocks = []
    buf    = []
    depth  = 0

    # Per-taal function keywords
    func_kw = {
        'python':     ('def ', 'async def ', 'class '),
        'rust':       ('fn ', 'pub fn ', 'async fn ', 'pub async fn ', 'impl ', 'struct ', 'enum '),
        'go':         ('func ', 'type '),
        'java':       ('public ', 'private ', 'protected ', 'class ', 'interface '),
        'csharp':     ('public ', 'private ', 'protected ', 'class ', 'interface ', 'struct '),
        'cpp':        ('void ', 'int ', 'bool ', 'auto ', 'class ', 'struct ', 'template'),
        'c':          ('void ', 'int ', 'char ', 'float ', 'double ', 'struct ', 'typedef'),
        'swift':      ('func ', 'class ', 'struct ', 'enum ', 'protocol '),
        'kotlin':     ('fun ', 'class ', 'object ', 'interface '),
        'zig':        ('fn ', 'pub fn ', 'const ', 'var '),
        'typescript': ('export function ', 'export async function ', 'export class ',
                       'function ', 'async function ', 'class ', 'const ', 'export const '),
        'javascript': ('function ', 'async function ', 'class ', 'const ', 'export function '),
    }
    kws = func_kw.get(lang, ('function ', 'class ', 'def '))

    for line in lines:
        stripped = line.strip()
        is_start = any(stripped.startswith(kw) for kw in kws)

        if is_start and depth == 0 and not buf:
            buf   = [line]
            depth = line.count('{') - line.count('}')
            if lang == 'python':
                depth = 1
        elif buf:
            buf.append(line)
            if lang == 'python':
                # Python: stop bij terug naar hetzelfde indentatieniveau
                if len(buf) > 2 and stripped == '' and len(buf) > 5:
                    blocks.append('\n'.join(buf).strip())
                    buf = []
            else:
                depth += line.count('{') - line.count('}')
                if depth <= 0:
                    blocks.append('\n'.join(buf).strip())
                    buf   = []
                    depth = 0
            if len(buf) > 150:
                buf   = []
                depth = 0

    return [b for b in blocks if len(b) > 80]


import random

# Diverse instructie templates per type — geeft beter getraind model
INSTRUCTION_TEMPLATES = {
    'implement': [
        'Implement the following {lang} function:\n{sig}',
        'Write a {lang} implementation for:\n{sig}',
        'Complete this {lang} function:\n{sig}',
        'Create a working {lang} version of:\n{sig}',
    ],
    'explain': [
        'Explain what this {lang} code does:\n{sig}',
        'What does this {lang} function do?\n{sig}',
        'Describe the purpose of this {lang} code:\n{sig}',
    ],
    'debug': [
        'Review and improve this {lang} function:\n{sig}',
        'What could go wrong with this {lang} code?\n{sig}',
        'Add error handling to this {lang} function:\n{sig}',
    ],
    'module': [
        'Write a {lang} module named {name}',
        'Create a {lang} file: {name}',
        'Implement a {lang} utility: {name}',
    ],
}

def pick_template(template_type: str, lang: str, sig: str = '', name: str = '') -> str:
    templates = INSTRUCTION_TEMPLATES.get(template_type, INSTRUCTION_TEMPLATES['implement'])
    t = random.choice(templates)
    return t.format(lang=lang, sig=sig[:200], name=name)


def code_to_samples(content: str, filepath: str, lang: str) -> list[dict]:
    samples = []
    lines   = content.splitlines()
    fname   = Path(filepath).name

    # Klein bestand → volledig voorbeeld met diverse instructies
    if len(lines) <= 60 and len(content) > 80:
        template_type = random.choice(['module', 'explain'])
        instruction   = pick_template(template_type, lang, name=fname)
        samples.append({
            'instruction': instruction,
            'input':       '',
            'output':      content.strip(),
            'source':      filepath,
            'lang':        lang,
        })
        return samples

    # Extract blokken — gebruik diverse instructie types
    blocks = extract_function_blocks(content, lang)[:10]
    for i, block in enumerate(blocks):
        first_line = block.splitlines()[0].strip()
        # Wissel af tussen implement, explain en debug
        template_type = ['implement', 'implement', 'explain', 'debug'][i % 4]
        instruction   = pick_template(template_type, lang, sig=first_line, name=fname)
        samples.append({
            'instruction': instruction,
            'input':       '',
            'output':      block,
            'source':      filepath,
            'lang':        lang,
        })

    return samples

# ─── Repo walker ─────────────────────────────────────────────────────────────

def fetch_repo_readme(owner: str, repo: str) -> str:
    """Haal README op voor context bij code — betere instructies."""
    for filename in ('README.md', 'readme.md', 'README.rst', 'README'):
        url     = f'https://api.github.com/repos/{owner}/{repo}/contents/{filename}'
        result  = gh_get(url)
        if result and result.get('download_url'):
            text = fetch_raw(result['download_url'])
            if text:
                # Haal eerste 500 chars op als context
                clean = text.replace('#', '').replace('*', '').replace('`', '')
                return ' '.join(clean.split())[:500]
    return ''


def collect_repo_files(owner: str, repo: str, extensions: set[str], path: str = '') -> list[dict]:
    url   = f'https://api.github.com/repos/{owner}/{repo}/contents/{path}'
    items = gh_get(url)
    if not items or not isinstance(items, list):
        return []

    results = []
    for item in items:
        if item.get('type') == 'dir':
            if item['name'] not in SKIP_DIRS:
                results.extend(collect_repo_files(owner, repo, extensions, item['path']))
        elif item.get('type') == 'file':
            if Path(item['name']).suffix in extensions and item.get('size', 0) <= MAX_FILE_BYTES:
                results.append({'path': item['path'], 'url': item.get('download_url', '')})
    return results

# ─── Seen hashes ─────────────────────────────────────────────────────────────

def load_seen() -> set[str]:
    return set(SEEN_FILE.read_text().splitlines()) if SEEN_FILE.exists() else set()

def save_seen(seen: set[str]):
    SEEN_FILE.write_text('\n'.join(seen))

# ─── Main ─────────────────────────────────────────────────────────────────────

def scrape(lang_filter: list[str] | None = None):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    seen  = load_seen()
    total = 0

    if SAMPLES_FILE.exists():
        with open(SAMPLES_FILE) as f:
            total = sum(1 for _ in f)
    print(f'[start] bestaande samples: {total:,} / {TARGET_SAMPLES:,}')

    langs = {k: v for k, v in LANGUAGES.items() if not lang_filter or k in lang_filter}
    print(f'[talen] {", ".join(langs.keys())}')

    out = open(SAMPLES_FILE, 'a', encoding='utf-8')
    try:
        for lang_name, lang_cfg in langs.items():
            if total >= TARGET_SAMPLES:
                break

            extensions = lang_cfg['extensions']
            queries    = lang_cfg['queries']

            print(f'\n══ {lang_name.upper()} ══')

            for query in queries:
                if total >= TARGET_SAMPLES:
                    break

                encoded    = urllib.parse.quote(query)
                search_url = (f'https://api.github.com/search/repositories'
                              f'?q={encoded}&sort=stars&order=desc&per_page=20')
                result = gh_get(search_url)
                if not result or 'items' not in result:
                    continue

                for repo_info in result['items']:
                    if total >= TARGET_SAMPLES:
                        break

                    owner = repo_info['owner']['login']
                    repo  = repo_info['name']
                    stars = repo_info.get('stargazers_count', 0)
                    if stars < MIN_STARS:
                        continue

                    print(f'  [{stars}★] {owner}/{repo}')
                    readme  = fetch_repo_readme(owner, repo)
                    files   = collect_repo_files(owner, repo, extensions)
                    print(f'    {len(files)} bestanden | readme: {"ja" if readme else "nee"}')

                    for fi in files[:30]:
                        if total >= TARGET_SAMPLES:
                            break

                        content = fetch_raw(fi['url'])
                        if not content or len(content) < 80:
                            continue

                        h = hashlib.sha256(content.encode()).hexdigest()[:16]
                        if h in seen:
                            continue
                        seen.add(h)

                        samples = code_to_samples(content, f'{owner}/{repo}/{fi["path"]}', lang_name)
                        # Voeg repo context toe als README beschikbaar is
                        if readme:
                            for s in samples:
                                s['repo_context'] = readme
                        for s in samples:
                            out.write(json.dumps(s, ensure_ascii=False) + '\n')
                            total += 1

                        if total % 500 == 0:
                            print(f'    ✓ {total:,} samples totaal')
                            out.flush()
                            save_seen(seen)

                        time.sleep(0.08)

                time.sleep(1.5)

    finally:
        out.close()
        save_seen(seen)

    print(f'\n[klaar] {total:,} samples → {SAMPLES_FILE}')

    # Stats per taal
    lang_counts: dict[str, int] = {}
    with open(SAMPLES_FILE) as f:
        for line in f:
            try:
                lang = json.loads(line).get('lang', 'unknown')
                lang_counts[lang] = lang_counts.get(lang, 0) + 1
            except Exception:
                pass
    print('\nVerdeling per taal:')
    for lang, count in sorted(lang_counts.items(), key=lambda x: -x[1]):
        bar = '█' * (count * 30 // max(lang_counts.values(), 1))
        print(f'  {lang:12s} {count:>6,}  {bar}')

    return total


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='FORGE Multi-Language Data Scraper')
    parser.add_argument('--token',  help='GitHub token (optioneel, verhoogt rate limit naar 5000/hr)')
    parser.add_argument('--target', type=int, default=10_000, help='Aantal samples (default: 10000)')
    parser.add_argument('--lang',   nargs='+', choices=list(LANGUAGES.keys()),
                        help='Specifieke talen (default: alle)')
    args = parser.parse_args()

    if args.token:
        GITHUB_TOKEN = args.token
    TARGET_SAMPLES = args.target

    print('══════════════════════════════════════════')
    print('  FORGE Data Scraper — Multi Language')
    print(f'  Target:       {TARGET_SAMPLES:,} samples')
    print(f'  GitHub token: {"✓ aanwezig (5000 req/hr)" if GITHUB_TOKEN else "✗ geen (60 req/hr)"}')
    print(f'  Talen:        {", ".join(args.lang) if args.lang else "alle (" + str(len(LANGUAGES)) + ")"}')
    print('══════════════════════════════════════════\n')

    scrape(lang_filter=args.lang)
