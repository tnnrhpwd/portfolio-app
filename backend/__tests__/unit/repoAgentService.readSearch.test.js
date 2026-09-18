/**
 * repoAgentService.readSearch.test.js — the two token-economics tools.
 *
 * Why these exist (measured 2026-09-18): the /net tool loop re-sends its fixed
 * prefix — 24 tool schemas (≈3.8K tokens) + system prompt — on EVERY model call,
 * and a repo turn spends up to 18 of them. A tool result therefore is not paid
 * for once; it is re-sent on every later call in the turn, and file reads
 * dominated (a whole 40 KB file ≈ 10K tokens, carried to the end).
 *
 *   `repo_search`  → `file:line` matches, no file contents: find without reading.
 *   `repo_read_file` → a bounded PAGE whose header carries the total line count
 *                      and the next offset, so truncation is a turn-around
 *                      rather than the dead end "showing first 40960 bytes" was.
 *
 * Part 1 is pure (`pageLines`, no git). Part 2 drives the real executors against
 * a temporary git repository via REPO_AGENT_ROOT — no GitHub, no network, no AWS.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoAgent = require('../../services/repoAgentService');

const admin = { isAdmin: true };
const read = (args) => repoAgent.REPO_TOOL_EXECUTORS.repo_read_file(args, admin);
const search = (args) => repoAgent.REPO_TOOL_EXECUTORS.repo_search(args, admin);

// ── Part 1: the paging arithmetic (pure) ────────────────────────────────────

describe('pageLines', () => {
  const file = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

  test('a small file is returned whole, with its line count and no continuation', () => {
    const page = repoAgent.pageLines(file(20), {});
    expect(page).toMatchObject({ total: 20, start: 1, end: 20, truncated: false });
    expect(page.body.split('\n')).toHaveLength(20);
  });

  test('a large file is paged, and the next offset continues without gap or overlap', () => {
    const first = repoAgent.pageLines(file(5000), {});
    expect(first).toMatchObject({ total: 5000, start: 1, end: 800, truncated: true });
    expect(first.body.split('\n')[0]).toBe('line 1');
    expect(first.body.split('\n').at(-1)).toBe('line 800');

    // The number the header tells the model to use must be exactly right: off by
    // one and it either re-reads a line forever or silently skips one.
    const second = repoAgent.pageLines(file(5000), { offset: first.end + 1 });
    expect(second.start).toBe(801);
    expect(second.body.split('\n')[0]).toBe('line 801');

    const last = repoAgent.pageLines(file(5000), { offset: 4801 });
    expect(last).toMatchObject({ start: 4801, end: 5000, truncated: false });
  });

  test('honours an explicit window and clamps nonsense', () => {
    expect(repoAgent.pageLines(file(500), { offset: 100, limit: 50 }))
      .toMatchObject({ start: 100, end: 149, truncated: true });
    // Limit over the ceiling, offset past EOF, zero/negative values: all clamped,
    // never an exception and never an empty page the caller would re-request.
    expect(repoAgent.pageLines(file(500), { limit: 999999 }).end).toBe(500);
    expect(repoAgent.pageLines(file(500), { offset: 9999 }).start).toBe(500);
    // `limit: 0` is a full DEFAULT page, not a one-line page the model would
    // have to ask for again — hence 800 lines of a 5000-line file, not 1.
    expect(repoAgent.pageLines(file(5000), { offset: 0, limit: 0 }))
      .toMatchObject({ start: 1, end: 800 });
  });

  test('one line longer than the byte cap yields a bounded page, not an empty one', () => {
    const page = repoAgent.pageLines('x'.repeat(200000), {});
    expect(page.body.length).toBeGreaterThan(0);
    expect(page.body.length).toBeLessThan(200000);
    expect(page.overLimit).toBe(true);
  });

  test('an empty file is one empty line, not a crash', () => {
    expect(repoAgent.pageLines('', {})).toMatchObject({ total: 1, start: 1, end: 1, truncated: false });
  });
});

// ── Part 2: the executors against a real temp repo ──────────────────────────

describe('repo_search + paged repo_read_file (temp repo, no network)', () => {
  let tmp;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repoagent-rs-'));

    const write = (rel, content) => {
      const abs = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    };

    write('README.md', 'project readme\n');
    write('src/a.js', 'alpha one\nalpha two\nMARKER_ALPHA here\n');
    write('src/b.js', 'MARKER_ALPHA too\n');
    write('src/nums.txt', 'a 1 + 1 b\nplain 11 here\n');
    write('src/pattern.txt', 'version 1.2.3\nno dot on this line\n');
    write('src/big.txt', Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`).join('\n'));
    // Tracked, but generated/vendored — the pathspecs must keep these OUT of
    // results, or a single search would drag a whole dependency tree in.
    write('node_modules/dep/index.js', 'MARKER_ALPHA in vendored code\n');
    write('src/bundle.min.js', 'MARKER_ALPHA in minified code\n');

    execSync('git init', { cwd: tmp, stdio: 'ignore' });
    execSync('git config user.email agent@test.local', { cwd: tmp, stdio: 'ignore' });
    execSync('git config user.name "Repo Agent Test"', { cwd: tmp, stdio: 'ignore' });
    execSync('git add -A -f', { cwd: tmp, stdio: 'ignore' });
    execSync('git commit -m init', { cwd: tmp, stdio: 'ignore' });

    process.env.REPO_AGENT_ROOT = tmp;
  });

  afterAll(() => {
    delete process.env.REPO_AGENT_ROOT;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('repo_search', () => {
    test('returns file:line locations and never file contents', async () => {
      const out = await search({ query: 'MARKER_ALPHA' });
      expect(out).toMatch(/^2 matching line\(s\) in 2 file\(s\)/);
      expect(out).toContain('src/a.js:3:MARKER_ALPHA here');
      expect(out).toContain('src/b.js:1:MARKER_ALPHA too');
    });

    test('excludes vendored and generated trees, and says so when it finds nothing', async () => {
      const out = await search({ query: 'MARKER_ALPHA' });
      expect(out).not.toContain('node_modules');
      expect(out).not.toContain('.min.js');

      const none = await search({ query: 'MARKER_ALPHA_NOT_THERE' });
      expect(none).toMatch(/^No matches/);
      // The exclusion has to be stated, or the model reads a miss as proof of
      // absence and goes off to write something that already exists.
      expect(none).toMatch(/node_modules, dist, build, coverage/);
    });

    test('defaults to a LITERAL substring; regex is opt-in', async () => {
      // A dot is a literal full stop by default, so only the line that HAS one
      // matches the line that reads "version 1.2.3".
      const literal = await search({ query: '.', path: 'src/pattern.txt' });
      expect(literal).toMatch(/^1 matching line/);

      // As an ERE the same character means "any character", so every non-empty
      // line matches. That difference is the whole reason literal is the
      // default: the text the model has on screen is not a regex.
      const asRegex = await search({ query: '.', regex: true, path: 'src/pattern.txt' });
      expect(asRegex).toMatch(/^2 matching line/);
    });

    test('ignore_case is opt-in', async () => {
      expect(await search({ query: 'marker_alpha' })).toMatch(/^No matches/);
      expect(await search({ query: 'marker_alpha', ignore_case: true })).toMatch(/^2 matching line/);
    });

    test('scopes to a path, and caps the result count', async () => {
      const scoped = await search({ query: 'MARKER_ALPHA', path: 'src/b.js' });
      expect(scoped).toMatch(/^1 matching line\(s\) in 1 file\(s\) under "src\/b\.js"/);

      // "line" appears in every line of big.txt, so the cap has to say it
      // truncated — otherwise a partial result reads as a complete one.
      const capped = await search({ query: 'line', max_results: 2 });
      expect(capped).toMatch(/showing the first 2/);
    });

    test('rejects bad input instead of shelling out', async () => {
      expect(await search({ query: '   ' })).toBe('Error: query is required.');
      expect(await search({ query: 'x'.repeat(500) })).toMatch(/Error: query is too long/);
      expect(await search({ query: 'MARKER_ALPHA', path: '../../etc' })).toBe('Error: invalid search path.');

      const notAdmin = await repoAgent.REPO_TOOL_EXECUTORS.repo_search({ query: 'x' }, { isAdmin: false });
      expect(notAdmin).toMatch(/restricted to the administrator/);
    });

    test('surfaces a broken regex as an error rather than throwing', async () => {
      const out = await search({ query: '([', regex: true });
      expect(out).toMatch(/^Error searching:/);
    });
  });

  describe('repo_read_file paging', () => {
    test('a small file is whole, and the body carries no line numbers to copy by mistake', async () => {
      const out = await read({ path: 'src/a.js' });
      expect(out).toMatch(/^File "src\/a\.js" \(3 lines\):/);
      // No numbering: repo_edit_file's old_string must be copied as the code
      // appears, and a "3: " prefix is exactly what Haiku copies by accident.
      expect(out).toContain('\nMARKER_ALPHA here');
      expect(out).not.toMatch(/\n\d+:/);
    });

    test('a large file comes back as a page the model can continue from', async () => {
      const out = await read({ path: 'src/big.txt' });
      expect(out).toMatch(/^File "src\/big\.txt" — lines 1–800 of 5000; continue with offset=801:/);
      expect(out).toContain('line 1');
      expect(out).not.toContain('line 801');

      const next = await read({ path: 'src/big.txt', offset: 801 });
      expect(next).toMatch(/^File "src\/big\.txt" — lines 801–1600 of 5000; continue with offset=1601:/);
      expect(next).toContain('line 801');
    });

    test('the last page says it is truncated no more', async () => {
      const out = await read({ path: 'src/big.txt', offset: 4901, limit: 200 });
      expect(out).toMatch(/^File "src\/big\.txt" \(5000 lines\):/);
      expect(out).toContain('line 5000');
    });
  });
});
