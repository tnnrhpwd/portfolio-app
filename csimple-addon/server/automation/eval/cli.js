#!/usr/bin/env node
/**
 * Eval harness CLI — run scenarios from a directory and print a summary.
 *
 * Usage:
 *   node csimple-addon/server/automation/eval/cli.js                  # run scenarios/
 *   node csimple-addon/server/automation/eval/cli.js scenarios/foo.yml
 *   node csimple-addon/server/automation/eval/cli.js --dry            # dry-run all
 *
 * Exit code: 0 if all scenarios pass (or are skipped), 1 if any fail.
 */

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const opts = { dryRun: false };
const positional = [];
for (const a of args) {
    if (a === '--dry' || a === '--dry-run') opts.dryRun = true;
    else if (a === '-h' || a === '--help') {
        console.log('Usage: cli.js [--dry] [scenario-file-or-dir]');
        process.exit(0);
    }
    else positional.push(a);
}

// We need to register tools before the runner can find them.
// Borrow the registration list from automation/index.js.
function registerAllTools() {
    const registry = require('../tool-registry');
    const shell = require('../tools/shell');
    const { fsRead, fsWrite, fsList } = require('../tools/fs');
    const { windowList, windowFocus, processList, processKill, clipboardRead, clipboardWrite } = require('../tools/system');
    const screen = require('../tools/screen');
    const screenRelay = require('../tools/screen-relay');
    const { screenOcr } = require('../tools/ocr');
    const { screenSetOfMarks } = require('../tools/set-of-marks');
    const {
        browserOpen, browserGoto, browserClick, browserFill,
        browserText, browserEval, browserScreenshot, browserStatus, browserClose,
    } = require('../tools/browser');
    const { uiaFind, uiaInvoke, uiaGetText, uiaSnapshot } = require('../tools/uia');
    const { perceptionRecent } = require('../perception');
    const { inputHold, inputTap, clickAt } = require('../tools/input');
    const { skillRun } = require('../tools/skill');

    const all = [
        fsRead, fsList, windowList, processList, clipboardRead, screen, screenOcr, screenSetOfMarks,
        uiaFind, uiaGetText, uiaSnapshot, perceptionRecent,
        browserOpen, browserGoto, browserText, browserScreenshot, browserStatus,
        fsWrite, clipboardWrite, browserClick, browserFill, browserClose,
        windowFocus, uiaInvoke, inputHold, inputTap, clickAt,
        processKill, shell, browserEval,
        skillRun, screenRelay,
    ];
    for (const t of all) {
        try { registry.register(t); }
        catch (e) {
            // Duplicate registration is fine when the addon already started.
            if (!String(e.message).includes('Duplicate')) throw e;
        }
    }
}

(async () => {
    registerAllTools();
    const { runScenarioFile, runScenarioDirectory } = require('./runner');

    const target = positional[0] || path.join(__dirname, 'scenarios');
    const stat = fs.existsSync(target) ? fs.statSync(target) : null;
    if (!stat) {
        console.error(`No scenario file or directory at ${target}`);
        process.exit(2);
    }

    let summary;
    if (stat.isDirectory()) {
        summary = await runScenarioDirectory(target, { dryRun: opts.dryRun, log: console.log });
    } else {
        const single = await runScenarioFile(target, { dryRun: opts.dryRun, log: console.log });
        summary = {
            directory: path.dirname(target), total: 1,
            passed: single.passed ? 1 : 0,
            failed: single.passed || single.skippedReason ? 0 : 1,
            skipped: single.skippedReason ? 1 : 0,
            reports: [single],
        };
    }

    console.log('');
    console.log('─── Eval Summary ───');
    console.log(`Directory: ${summary.directory}`);
    console.log(`Total:     ${summary.total}`);
    console.log(`Passed:    ${summary.passed}`);
    console.log(`Skipped:   ${summary.skipped}`);
    console.log(`Failed:    ${summary.failed}`);
    if (summary.failed > 0) {
        console.log('');
        console.log('Failures:');
        for (const r of summary.reports) {
            if (!r.passed && !r.skippedReason) {
                console.log(`  ❌ ${r.name}`);
                for (const f of r.failures) console.log(`     - ${f}`);
            }
        }
    }
    process.exit(summary.failed > 0 ? 1 : 0);
})().catch(err => {
    console.error('[eval] fatal:', err);
    process.exit(2);
});
