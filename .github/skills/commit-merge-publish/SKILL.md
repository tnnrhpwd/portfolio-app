---
name: commit-merge-publish
description: Commit outstanding changes, merge the topic branch into its base branch, push to origin, and (when the change touches simple-addon/) cut a new Simple Addon release so the auto-updater can pick it up. Use when the user wants a single "ship it" action instead of running /commit, /merge, and a manual push/release separately.
---
<!-- Repo skill: chains the existing commit + merge skills with an explicit publish (push) step, plus an addon-release step when appropriate. -->

# Commit, Merge & Publish

A single skill that takes a session's work all the way from "uncommitted changes in a worktree" to "live on origin (and, for Simple Addon changes, actually shipped to installed apps)". Combines what the built-in `/commit` and `/merge` skills do, then adds the two steps users otherwise forget: pushing the result, and — for `simple-addon/` changes — cutting a real release, since merging to `master` alone does **not** update anyone's installed Simple Addon (that only happens once a tagged build is published and the auto-updater/`npm run release` flow runs).

## Guidelines

- **Never amend, rebase, reset, or force-push** without explicit user approval.
- **Never skip commit/push hooks** (no `--no-verify`).
- **Never rewrite or drop commits.**
- If any step is ambiguous (which base branch, whether to cut a release, how to resolve a conflict) — ask the user rather than guessing.
- This skill performs a **regular** `git push` (not force) once merged — that's expected and doesn't require extra approval, per the existing `sync` skill's convention.

## Workflow

### 1. Commit outstanding changes

```
git status --porcelain
```
- If there are staged changes, commit only those.
- If there are only unstaged changes, `git add -A` then commit.
- If the tree is already clean, skip straight to step 2.

Sample recent commits to match the repo's message convention (this repo uses Conventional-Commits-style `type(scope): summary`, e.g. `feat(simple-addon): ...`, `fix(pricing): ...`):
```
git log --oneline -20
```
Draft a subject (≤72 chars) + optional body explaining *why*, then commit:
```
git commit -m "<subject>" -m "<body>"
```

### 2. Merge the topic branch into its base branch

Identify the current (topic) branch and the base/main worktree:
```
git branch --show-current
git worktree list
```
The base branch is normally checked out in the main worktree (the repo root, not a `*.worktrees/*` path). If it's unclear which branch is the merge target, ask the user.

Merge without leaving the current worktree:
```
git -C <main-worktree-path> merge <topic-branch>
```
If there are conflicts, resolve them preserving both sides' intent, `git -C <main-worktree-path> add <file>` each resolved file, then `git -C <main-worktree-path> commit --no-edit`. Ask the user if a conflict resolution is unclear, and offer `git -C <main-worktree-path> merge --abort` if they want to stop.

Validate:
```
git -C <main-worktree-path> status --porcelain
git -C <main-worktree-path> merge-base --is-ancestor <topic-branch> HEAD
```

### 3. Publish: push the base branch to origin

```
git -C <main-worktree-path> push origin <base-branch>
```
If the push is rejected (remote has diverged), fetch and report the situation to the user rather than force-pushing.

### 4. Simple Addon release (only if the merged changes touch `simple-addon/`)

Check whether the just-merged commits touched the addon:
```
git -C <main-worktree-path> diff --name-only <previous-base-sha>..<new-base-sha> -- simple-addon/
```
If that list is non-empty:

4.1. Tell the user that a plain merge/push does **not** update installed copies of Simple Addon — only a tagged, CI-published release does (`simple-addon/release.js` bumps `package.json`'s build number, commits, tags `addon-vX.Y.Z`, and pushes; `.github/workflows/build-addon.yml` then builds and publishes the GitHub Release; each running app's `auto-updater.js` checks periodically, or the user can click "Check for Updates" in the Dashboard).

4.2. If the user wants to ship it now (ask if not already implied by their request), run from `simple-addon/`:
```
node release.js
```
This is interactive-free and does its own preflight (uncommitted-changes check, remote check) — do not duplicate its logic, just run it and report its output.

4.3. Confirm the CI run picked it up:
```
gh run list --repo tnnrhpwd/portfolio-app --workflow=build-addon.yml --limit 3
```
Report the run URL/status to the user so they can watch it land, and remind them the update reaches their running app once CI finishes publishing and the app's next auto-update check (or manual "Check for Updates") runs.

## Validation

After the full flow:
1. `git -C <main-worktree-path> status --porcelain` — clean.
2. `git -C <main-worktree-path> rev-list --left-right --count <base-branch>...origin/<base-branch>` — 0 ahead, 0 behind.
3. If an addon release was cut, confirm the new tag exists on origin: `git -C <main-worktree-path> ls-remote --tags origin addon-v*` and that a CI run is queued/running for it.
