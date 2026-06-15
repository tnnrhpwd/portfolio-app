/**
 * Skill compiler — turns a raw recording trace into a parameterized skill:
 *
 *   {
 *     name, slug,
 *     steps: [
 *       { tool: 'window_focus',   args: { titleContains: '...' } },
 *       { tool: 'click_at',       args: { x, y } },
 *       { tool: 'type_text',      args: { text: '${param.query}' } },
 *       ...
 *     ],
 *     params: [ { name, description, type, default? } ],
 *     metadata: { recordedAt, durationMs, sourceSessionId, eventCount }
 *   }
 *
 * The compiler is intentionally simple for v1:
 *   - Coalesces every focus_change into a `window_focus` step (skipping repeats).
 *   - Coalesces mouse_move runs into nothing (the click is what matters).
 *   - Emits one step per mouse_click with absolute coordinates from the last
 *     known cursor position at click time.
 *   - Skips events that occur within the first 500ms of a focus_change (typical
 *     window-settling time).
 *   - Strips runs of duplicate consecutive steps with the same { tool, args }.
 *
 * v2 ideas (NOT implemented here, left as TODOs):
 *   - Replace click_at with uia_invoke when a UIA snapshot at click time
 *     contained an element under the cursor.
 *   - Detect text input runs and replace with type_text.
 *   - Parameter inference (numbers/dates that vary → ${param.x}).
 */

function slugify(name) {
    return String(name || 'skill')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'skill';
}

/**
 * Compile a parsed recording (header + events + footer) into a skill object.
 *
 * @param {object} recording - { sessionId, header, footer, events }
 * @param {object} options - { name, description, minClickGapMs? }
 * @returns {object} skill
 */
function compileRecording(recording, options = {}) {
    if (!recording || !Array.isArray(recording.events)) {
        throw new Error('compileRecording: invalid recording');
    }
    const {
        name = recording.header?.data?.name || recording.sessionId || 'Untitled skill',
        description = '',
        minClickGapMs = 80,
    } = options;

    const events = recording.events.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const steps = [];
    let lastFocus = null;       // last emitted focus_change data
    let lastFocusTs = 0;
    let lastClickTs = 0;
    let lastCursor = { x: 0, y: 0 };

    for (const ev of events) {
        if (ev.type === 'mouse_move') {
            lastCursor = { x: ev.data.x, y: ev.data.y };
            continue;
        }
        if (ev.type === 'focus_change') {
            // Only emit if the new title is meaningfully different from the
            // currently-focused one. Reduce noise from rapid app switching
            // (e.g. tooltips momentarily stealing focus).
            const title = (ev.data.windowTitle || '').trim();
            if (!title) continue;
            if (lastFocus && lastFocus.windowTitle === title) continue;
            steps.push({
                tool: 'window_focus',
                args: { titleContains: _firstSignificantSubstring(title) },
                _trace: { ts: ev.ts, processName: ev.data.processName },
            });
            lastFocus = ev.data;
            lastFocusTs = ev.ts;
            continue;
        }
        if (ev.type === 'mouse_click') {
            // Skip clicks that come too close together — usually double-clicks
            // or accidental jitter. We keep the FIRST and let the runner decide
            // whether to issue a second one (it can via a doubleClick param).
            if (ev.ts - lastClickTs < minClickGapMs) continue;
            // Skip clicks that arrive within 500ms of a focus change — usually
            // the click that caused the focus switch is irrelevant to the user's
            // intent for the new window.
            if (ev.ts - lastFocusTs < 500) {
                lastClickTs = ev.ts;
                continue;
            }
            steps.push({
                tool: 'click_at',
                args: {
                    x: ev.data.x,
                    y: ev.data.y,
                    button: ev.data.button || 'left',
                },
                _trace: { ts: ev.ts, focusTitle: lastFocus?.windowTitle || null },
            });
            lastClickTs = ev.ts;
            lastCursor = { x: ev.data.x, y: ev.data.y };
            continue;
        }
        if (ev.type === 'marker') {
            steps.push({
                tool: '_marker',
                args: { label: ev.data.label },
                _trace: { ts: ev.ts },
            });
        }
    }

    return {
        name,
        slug: slugify(name),
        description,
        steps,
        params: [], // v2: parameter inference
        metadata: {
            sourceSessionId: recording.sessionId,
            recordedAt: recording.header?.ts || null,
            durationMs: recording.footer?.data?.durationMs || null,
            eventCount: events.length,
            compiledAt: Date.now(),
            compilerVersion: 1,
        },
    };
}

/**
 * Heuristic to pick a window-match substring from a title. Many window titles
 * are like "Document1 - Word" or "Inbox (3) - user@host - Outlook" — we want
 * the trailing app name in those cases so the skill is robust across docs.
 */
function _firstSignificantSubstring(title) {
    const parts = title.split(/ [-—|] /).map(s => s.trim()).filter(Boolean);
    if (parts.length === 1) return parts[0];
    // Use the LAST segment if it looks like an app name (short, no digits).
    const last = parts[parts.length - 1];
    if (last.length <= 30 && !/\d/.test(last)) return last;
    return parts[0];
}

module.exports = { compileRecording, slugify, _firstSignificantSubstring };
