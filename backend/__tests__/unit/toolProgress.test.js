/**
 * toolProgress.test.js — the short "what is happening" lines the /net chat shows
 * while the agent works (see backend/services/toolProgress.js).
 */

const { describeToolActivity, fileBasename } = require('../../services/toolProgress');

describe('toolProgress.fileBasename', () => {
    test('returns the last segment for posix and windows paths', () => {
        expect(fileBasename('a/b/c/GoalManager.jsx')).toBe('GoalManager.jsx');
        expect(fileBasename('a\\b\\Net.css')).toBe('Net.css');
        expect(fileBasename('single.js')).toBe('single.js');
    });

    test('returns an empty string for nothing', () => {
        expect(fileBasename('')).toBe('');
        expect(fileBasename(null)).toBe('');
        expect(fileBasename(undefined)).toBe('');
    });
});

describe('toolProgress.describeToolActivity', () => {
    test('names the file for repository reads, edits and writes', () => {
        expect(describeToolActivity('repo_read_file', { path: 'frontend/src/components/SimpleAddon/GoalManager.jsx' }))
            .toBe('Reading GoalManager.jsx…');
        expect(describeToolActivity('repo_edit_file', { path: 'frontend/src/pages/Simple/Net/Net.css' }))
            .toBe('Editing Net.css…');
        expect(describeToolActivity('repo_write_file', { path: 'docs/new.md' })).toBe('Writing new.md…');
    });

    test('describes the git tools without needing arguments', () => {
        expect(describeToolActivity('repo_list_files', {})).toBe('Listing repository files…');
        expect(describeToolActivity('repo_git_status', {})).toBe('Checking git status…');
        expect(describeToolActivity('repo_git_diff', {})).toBe('Reviewing the change…');
        expect(describeToolActivity('repo_commit_changes', {})).toBe('Committing the change…');
        expect(describeToolActivity('repo_push', {})).toBe('Pushing to GitHub…');
    });

    test('describes the ordinary chat tools', () => {
        expect(describeToolActivity('generate_image', { prompt: 'a cat' })).toBe('Generating an image…');
        expect(describeToolActivity('save_goal', { name: 'trip' })).toBe('Saving your goal…');
        expect(describeToolActivity('submit_support_ticket', { subject: 'x' })).toBe('Submitting the ticket…');
    });

    test('never leaks arguments beyond the file basename', () => {
        const label = describeToolActivity('repo_write_file', { path: 'a/b/secret.txt', content: 'hunter2' });
        expect(label).toBe('Writing secret.txt…');
        expect(label).not.toContain('hunter2');
    });

    test('handles a file tool with no path rather than printing "undefined"', () => {
        expect(describeToolActivity('repo_edit_file')).toBe('Editing a file…');
        expect(describeToolActivity('repo_read_file', {})).toBe('Reading a file…');
    });

    test('falls back to the tool name for an unknown tool', () => {
        expect(describeToolActivity('mystery_tool')).toBe('Running mystery_tool…');
        expect(describeToolActivity(undefined)).toBe('Running a tool…');
    });
});
