/**
 * toolProgress.js — short, human-readable progress lines for the /net chat.
 *
 * The /net streaming route resolves tool calls BEFORE it streams any text: a
 * repo task is a dozen non-streamed model calls plus file reads and writes, so
 * for up to a minute the client had literally nothing to render. Users read that
 * as "it has frozen" (observed 2026-09-14). This module turns a tool call into a
 * few words the chat can show live — "Editing Net.css…", "Checking git status…".
 *
 * Deliberately pure and dependency-free so the labels can be unit-tested and
 * reused by any caller that wants to describe a tool call.
 *
 * Rules for labels:
 *   - start with a gerund, end with an ellipsis (they are always in progress);
 *   - name the file's BASENAME only — a full repo path is noise on a phone;
 *   - never include tool arguments beyond that (no file contents, no secrets);
 *   - an unknown tool still gets something honest: "Running <tool>…".
 */

/** Last path segment, so labels stay short: "a/b/C.jsx" → "C.jsx". */
function fileBasename(p) {
  const s = String(p || '').trim().replace(/\\/g, '/');
  if (!s) return '';
  return s.split('/').filter(Boolean).pop() || '';
}

/** tool name → (args) => label without the trailing ellipsis. */
const TOOL_ACTIVITY = Object.freeze({
  // Repository tools (admin only)
  repo_list_files: () => 'Listing repository files',
  repo_read_file: (args) => `Reading ${fileBasename(args?.path) || 'a file'}`,
  // No query in the label: labels never carry tool arguments (see the rules at
  // the top of this file) — a search string can be long and is not needed to
  // say what is happening.
  repo_search: () => 'Searching the repository',
  repo_write_file: (args) => `Writing ${fileBasename(args?.path) || 'a file'}`,
  repo_edit_file: (args) => `Editing ${fileBasename(args?.path) || 'a file'}`,
  repo_git_status: () => 'Checking git status',
  repo_git_diff: () => 'Reviewing the change',
  repo_commit_changes: () => 'Committing the change',
  repo_push: () => 'Pushing to GitHub',
  // A check the agent runs on its own work. The label names the task, not the
  // raw arguments (see the rules at the top of this file).
  repo_run: (args) => {
    const TASK_LABEL = {
      'test:file': 'Running the test',
      'test:backend': 'Running the backend tests',
      typecheck: 'Type-checking',
      lint: 'Linting',
      build: 'Building the frontend',
    };
    return TASK_LABEL[args?.task] || 'Running a project check';
  },

  // /net chat tools
  generate_image: () => 'Generating an image',
  web_search_suggestion: () => 'Searching the web',
  calculate: () => 'Doing the math',
  get_current_datetime: () => 'Checking the date and time',
  save_goal: () => 'Saving your goal',
  save_goals: () => 'Saving your goals',
  get_my_goals: () => 'Reading your goals',
  save_note: () => 'Saving a note',
  get_my_notes: () => 'Reading your notes',
  log_action: () => 'Logging the action',
  update_memory: () => 'Updating memory',
  delete_memory: () => 'Forgetting a memory',
  update_personality: () => 'Updating personality settings',
  update_behavior: () => 'Updating behavior settings',
  summarize_conversation: () => 'Summarizing the conversation',
  submit_support_ticket: () => 'Submitting the ticket',
});

/**
 * A few words describing what a tool call is doing, ready to display.
 * @param {string} toolName
 * @param {Object} [args] - the call's parsed arguments (only paths are read).
 * @returns {string} e.g. "Editing Net.css…"
 */
function describeToolActivity(toolName, args) {
  const describe = TOOL_ACTIVITY[toolName];
  const label = describe ? describe(args || {}) : `Running ${toolName || 'a tool'}`;
  return `${label}…`;
}

/**
 * Which PLANE a tool runs on. Three planes exist (NET_HARNESS_PLAN.md §3):
 *
 *   cloud  — in-process on the backend (goals, notes, image, math, search…)
 *   repo   — in-process on the backend, but touching this repository via git
 *   addon  — the user's own PC, dispatched over the relay (P2; nothing is on
 *            this plane yet, but the classifier is here so the journal, the UI
 *            badge and the future policy gate all read one answer)
 *
 * Deliberately a pure name→plane map rather than a lookup against the schema
 * list: it must answer for a tool name that was never offered (a hallucinated
 * one still gets logged, and "cloud" is the honest default for anything local).
 */
function toolPlane(toolName) {
  const name = String(toolName || '');
  if (name.startsWith('repo_')) return 'repo';
  if (name.startsWith('pc_') || name.startsWith('addon_')) return 'addon';
  return 'cloud';
}

module.exports = {
  TOOL_ACTIVITY,
  describeToolActivity,
  fileBasename,
  toolPlane,
};
