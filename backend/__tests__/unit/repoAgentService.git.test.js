/**
 * repoAgentService.git.test.js — integration tests that drive the repo agent
 * against a real (temporary) git repository. No GitHub, no AWS, no network:
 * the repo root is pointed at a temp clone via REPO_AGENT_ROOT, and the
 * proposal store is swapped for an in-memory fake via _setProposalStoreForTests.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoAgent = require('../../services/repoAgentService');

function runGit(cwd, args) {
  return execSync(`git ${args}`, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('repoAgentService git integration (temp repo, no GitHub)', () => {
  let tmp;
  let bare;
  const admin = { isAdmin: true };

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repoagent-'));
    bare = fs.mkdtempSync(path.join(os.tmpdir(), 'repoagent-bare-'));

    // Bare remote (target of `git push`).
    runGit(bare, 'init --bare');

    // Working repo with one commit on master.
    runGit(tmp, 'init');
    runGit(tmp, 'config user.email agent@test.local');
    runGit(tmp, 'config user.name "Repo Agent Test"');
    fs.writeFileSync(path.join(tmp, 'README.md'), 'hello\n');
    runGit(tmp, 'add -A');
    runGit(tmp, 'commit -m init');
    runGit(tmp, 'branch -M master');
    runGit(tmp, `remote add origin ${bare}`);

    process.env.REPO_AGENT_ROOT = tmp;
    delete process.env.GITHUB_TOKEN;

    // In-memory proposal store (no AWS/DynamoDB).
    const mem = new Map();
    repoAgent._setProposalStoreForTests({
      async save(userId, p) { mem.set(userId, p); },
      async load(userId) { return mem.get(userId) || null; },
      async clear(userId) { mem.delete(userId); },
    });
  });

  afterAll(() => {
    delete process.env.REPO_AGENT_ROOT;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(bare, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('write → commit → push lands a feature branch on the remote', async () => {
    const write = await repoAgent.REPO_TOOL_EXECUTORS.repo_write_file(
      { path: 'src/new.txt', content: 'made by agent\n' },
      admin
    );
    expect(write).toMatch(/Wrote "src\/new.txt"/);

    const commit = await repoAgent.REPO_TOOL_EXECUTORS.repo_commit_changes(
      { message: 'Add new.txt' },
      { ...admin, userId: 'u1' }
    );
    expect(commit).toMatch(/Committed 1 file\(s\) on feature branch net\//);
    expect(commit).toMatch(/Add new.txt/);

    const push = await repoAgent.REPO_TOOL_EXECUTORS.repo_push(
      {},
      { ...admin, userId: 'u1', userMessage: 'yes, push it', turnStartedAt: Date.now() + 60000 }
    );
    expect(push).toMatch(/Pushed feature branch net\//);
    expect(push).toMatch(/compare/);

    // The bare remote now contains the feature branch (not committed to master).
    const branches = runGit(bare, 'branch --list').trim();
    expect(branches).toMatch(/net\//);
  });

  test('repo_push refuses a same-turn commit', async () => {
    const t0 = Date.now();
    await repoAgent.REPO_TOOL_EXECUTORS.repo_write_file(
      { path: 'src/second.txt', content: 'x\n' },
      admin
    );
    const commit = await repoAgent.REPO_TOOL_EXECUTORS.repo_commit_changes(
      { message: 'Add second' },
      { ...admin, userId: 'u1' }
    );
    expect(commit).toMatch(/feature branch/);

    const push = await repoAgent.REPO_TOOL_EXECUTORS.repo_push(
      {},
      { ...admin, userId: 'u1', userMessage: 'yes, push it', turnStartedAt: t0 }
    );
    expect(push).toMatch(/Push NOT performed/);
    expect(push).toMatch(/THIS conversation turn/);
  });

  test('repo_commit_changes with no changes reports nothing to commit', async () => {
    const result = await repoAgent.REPO_TOOL_EXECUTORS.repo_commit_changes(
      { message: 'nothing' },
      { ...admin, userId: 'u1' }
    );
    expect(result).toMatch(/No changes to commit/);
  });

  test('repo_edit_file replaces a snippet in an existing file without a full rewrite', async () => {
    fs.writeFileSync(path.join(tmp, 'src/edit-target.jsx'), [
      'export default function GoalManager() {',
      '  const LIMIT = 500;',
      '}',
    ].join('\n'));

    const result = await repoAgent.REPO_TOOL_EXECUTORS.repo_edit_file(
      { path: 'src/edit-target.jsx', old_string: 'const LIMIT = 500;', new_string: 'const LIMIT = 4000;' },
      admin
    );

    expect(result).toMatch(/Edited "src\/edit-target.jsx" \(1 replacement\)/);
    expect(fs.readFileSync(path.join(tmp, 'src/edit-target.jsx'), 'utf-8')).toContain('const LIMIT = 4000;');
  });

  test('repo_edit_file refuses an ambiguous snippet unless replace_all is set', async () => {
    fs.writeFileSync(path.join(tmp, 'src/ambiguous.js'), 'let x = 1;\nlet y = 1;\n');

    const refused = await repoAgent.REPO_TOOL_EXECUTORS.repo_edit_file(
      { path: 'src/ambiguous.js', old_string: '= 1;', new_string: '= 2;' },
      admin
    );
    expect(refused).toMatch(/appears 2 times/);
    expect(fs.readFileSync(path.join(tmp, 'src/ambiguous.js'), 'utf-8')).toBe('let x = 1;\nlet y = 1;\n');

    const all = await repoAgent.REPO_TOOL_EXECUTORS.repo_edit_file(
      { path: 'src/ambiguous.js', old_string: '= 1;', new_string: '= 2;', replace_all: true },
      admin
    );
    expect(all).toMatch(/2 replacements/);
    expect(fs.readFileSync(path.join(tmp, 'src/ambiguous.js'), 'utf-8')).toBe('let x = 2;\nlet y = 2;\n');
  });

  test('repo_edit_file never invents a snippet that is not in the file', async () => {
    fs.writeFileSync(path.join(tmp, 'src/present.js'), 'hello\n');

    const missing = await repoAgent.REPO_TOOL_EXECUTORS.repo_edit_file(
      { path: 'src/present.js', old_string: 'nope', new_string: 'yes' },
      admin
    );
    expect(missing).toMatch(/was not found/);
    expect(fs.readFileSync(path.join(tmp, 'src/present.js'), 'utf-8')).toBe('hello\n');

    const absent = await repoAgent.REPO_TOOL_EXECUTORS.repo_edit_file(
      { path: 'src/never-created.js', old_string: 'a', new_string: 'b' },
      admin
    );
    expect(absent).toMatch(/does not exist/);
  });

  test('repo_edit_file edits a file too large to rewrite as a tool argument', async () => {
    // ~12 KB of filler: the size at which repo_write_file's arguments came back
    // truncated, so the write never landed at all.
    const filler = Array.from({ length: 400 }, (_, i) => `// filler line ${i}`).join('\n');
    const target = path.join(tmp, 'src/big.jsx');
    fs.writeFileSync(target, `${filler}\nconst LIMIT = 500;\n`);

    const result = await repoAgent.REPO_TOOL_EXECUTORS.repo_edit_file(
      { path: 'src/big.jsx', old_string: 'const LIMIT = 500;', new_string: 'const LIMIT = 4000;' },
      admin
    );

    expect(result).toMatch(/Edited/);
    const after = fs.readFileSync(target, 'utf-8');
    expect(after).toContain('const LIMIT = 4000;');
    expect(after).toContain('// filler line 399');
  });
});
