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
  repo_write_file: (args) => `Writing ${fileBasename(args?.path) || 'a file'}`,
  repo_edit_file: (args) => `Editing ${fileBasename(args?.path) || 'a file'}`,
  repo_git_status: () => 'Checking git status',
  repo_git_diff: () => 'Reviewing the change',
  repo_commit_changes: () => 'Committing the change',
  repo_push: () => 'Pushing to GitHub',

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

module.exports = {
  TOOL_ACTIVITY,
  describeToolActivity,
  fileBasename,
};
