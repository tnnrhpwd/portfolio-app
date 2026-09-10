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
});
