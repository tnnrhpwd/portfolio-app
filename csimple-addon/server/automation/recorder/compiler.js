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

// Keys considered modifiers when folding key_down events into input_tap
// combos. Names match polling-source.js KEY_MAP.
const MODIFIER_KEYS = new Set(['shift', 'ctrl', 'alt', 'lwin', 'rwin']);

// Threshold above which a keypress is treated as a deliberate hold and
// emitted as `input_hold` (with durationMs) instead of `input_tap`. Below
// this it's just a normal tap. 200ms matches typical "quick press" feel
// while still capturing WASD-style movement holds cleanly.
const HOLD_THRESHOLD_MS = 200;

// Mouse tuning. Path buffering + drag detection thresholds.
const MOUSE_HOLD_THRESHOLD_MS = 200;   // stationary hold cutoff (tap vs hold)
const MOUSE_DRAG_MIN_DISTANCE_PX = 8;  // total path distance to qualify as a drag
const MOUSE_PATH_IDLE_FLUSH_MS = 400;  // flush a bare mouse-move buffer after this idle gap
const MOUSE_PATH_MIN_POINTS = 3;       // don't emit mouse_path for tiny wobbles
const MOUSE_PATH_MIN_DURATION_MS = 120;

function _pathDistance(points) {
    let d = 0;
    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        d += Math.hypot(dx, dy);
    }
    return d;
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
    // Modifiers currently held (from key_down events). Emitted as a prefix on
    // each non-modifier keydown so combos like Ctrl+C, Shift+Tab, Alt+Enter
    // become a single input_tap { keys: ['ctrl','c'] } step.
    const heldModifiers = new Set();
    // Non-modifier keys currently held, awaiting their key_up so we can
    // compute duration and decide tap vs hold. Keyed by resolved name.
    const pendingKeys = new Map();

    // Mouse state machine — pairs mouse_click (down edge) with mouse_up so
    // we can classify each interaction as a click, a stationary hold, or a
    // drag (button held while cursor moves). Standalone mouse_move runs
    // (no button held) accumulate in `moveBuffer` and flush as mouse_path
    // steps when the user pauses / clicks / switches windows / ends.
    const pendingPress = new Map(); // button -> { downTs, downX, downY, focusTitle, movesInside: [{x,y,ts}] }
    let moveBuffer = [];            // [{ x, y, ts }] with lastFocus snapshot

    const _flushMoveBuffer = () => {
        if (moveBuffer.length < MOUSE_PATH_MIN_POINTS) { moveBuffer = []; return; }
        const first = moveBuffer[0];
        const last = moveBuffer[moveBuffer.length - 1];
        const duration = last.ts - first.ts;
        const distance = _pathDistance(moveBuffer);
        if (duration < MOUSE_PATH_MIN_DURATION_MS || distance < MOUSE_DRAG_MIN_DISTANCE_PX) {
            moveBuffer = [];
            return;
        }
        const path = moveBuffer.map(p => ({ x: p.x, y: p.y, tOffsetMs: p.ts - first.ts }));
        const args = { path };
        if (lastFocus?.windowTitle) args.focusWindowTitle = _firstSignificantSubstring(lastFocus.windowTitle);
        steps.push({
            tool: 'mouse_path',
            args,
            _trace: { ts: first.ts, endTs: last.ts, points: path.length, distancePx: Math.round(distance), focusTitle: lastFocus?.windowTitle || null },
        });
        moveBuffer = [];
    };

    // Emit the right step for a completed (or forcibly closed) mouse press:
    //   - drag: any inside-movement crossing MOUSE_DRAG_MIN_DISTANCE_PX → mouse_drag { button, path }
    //   - hold: stationary press >= MOUSE_HOLD_THRESHOLD_MS → mouse_drag { button, path:[downPt], holdMs }
    //   - click: everything else → click_at (respecting the double-click dedupe window)
    const _emitMousePress = (press, button, upTs, upX, upY, orphaned) => {
        const focusHint = press.focusTitle ? _firstSignificantSubstring(press.focusTitle) : null;
        // Build the full path: down point → interior moves → up point.
        const pts = [{ x: press.downX, y: press.downY, ts: press.downTs }];
        for (const m of press.movesInside) pts.push(m);
        if (!orphaned) pts.push({ x: upX, y: upY, ts: upTs });
        const distance = _pathDistance(pts);
        const duration = Math.max(0, (upTs || press.downTs) - press.downTs);
        const isDrag = distance >= MOUSE_DRAG_MIN_DISTANCE_PX && pts.length >= 2 && !orphaned;
        if (isDrag) {
            const path = pts.map(p => ({ x: p.x, y: p.y, tOffsetMs: p.ts - press.downTs }));
            const args = { button, path };
            if (focusHint) args.focusWindowTitle = focusHint;
            steps.push({
                tool: 'mouse_drag',
                args,
                _trace: { ts: press.downTs, releasedTs: upTs, distancePx: Math.round(distance), focusTitle: press.focusTitle },
            });
            return;
        }
        if (!orphaned && duration >= MOUSE_HOLD_THRESHOLD_MS) {
            const args = {
                button,
                path: [{ x: press.downX, y: press.downY, tOffsetMs: 0 }],
                holdMs: duration,
            };
            if (focusHint) args.focusWindowTitle = focusHint;
            steps.push({
                tool: 'mouse_drag',
                args,
                _trace: { ts: press.downTs, releasedTs: upTs, hold: true, focusTitle: press.focusTitle },
            });
            return;
        }
        // Short tap → click_at (double-click dedupe window applies here too).
        if (press.downTs - lastClickTs < minClickGapMs) {
            lastClickTs = press.downTs;
            return;
        }
        const clickArgs = { x: press.downX, y: press.downY, button };
        if (focusHint) clickArgs.focusWindowTitle = focusHint;
        steps.push({
            tool: 'click_at',
            args: clickArgs,
            _trace: { ts: press.downTs, releasedTs: upTs, focusTitle: press.focusTitle, orphaned: !!orphaned },
        });
        lastClickTs = press.downTs;
    };

    const _flushPendingKey = (name, upTs) => {
        const pending = pendingKeys.get(name);
        if (!pending) return;
        pendingKeys.delete(name);
        const duration = Math.max(0, (upTs || pending.downTs) - pending.downTs);
        const keys = [...pending.modifiers, name];
        const isHold = duration >= HOLD_THRESHOLD_MS;
        const tool = isHold ? 'input_hold' : 'input_tap';
        const args = { keys };
        if (isHold) args.durationMs = duration;
        if (pending.focusTitle) args.focusWindowTitle = _firstSignificantSubstring(pending.focusTitle);
        steps.push({
            tool,
            args,
            _trace: { ts: pending.downTs, releasedTs: upTs || null, focusTitle: pending.focusTitle },
        });
    };

    for (const ev of events) {
        if (ev.type === 'mouse_move') {
            lastCursor = { x: ev.data.x, y: ev.data.y };
            // Movement while a button is held belongs to that press (drag path).
            // Otherwise buffer it as standalone cursor motion (camera-look, etc.).
            if (pendingPress.size > 0) {
                for (const press of pendingPress.values()) {
                    press.movesInside.push({ x: ev.data.x, y: ev.data.y, ts: ev.ts });
                }
            } else {
                // Idle-gap flush: if the user paused, split into separate paths.
                if (moveBuffer.length > 0 && (ev.ts - moveBuffer[moveBuffer.length - 1].ts) > MOUSE_PATH_IDLE_FLUSH_MS) {
                    _flushMoveBuffer();
                }
                moveBuffer.push({ x: ev.data.x, y: ev.data.y, ts: ev.ts });
            }
            continue;
        }
        if (ev.type === 'focus_change') {
            // A window switch always terminates any buffered mouse-path.
            _flushMoveBuffer();
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
        if (ev.type === 'key_down') {
            const name = ev.data && ev.data.name;
            if (!name) continue;
            if (MODIFIER_KEYS.has(name)) {
                // Just track the held state — the tap emits when the main key
                // arrives, so Ctrl+C is captured as one step, not two.
                heldModifiers.add(name);
                continue;
            }
            // Defer emission until key_up so we can distinguish a quick tap
            // from a deliberate hold based on how long the key was down.
            if (!pendingKeys.has(name)) {
                pendingKeys.set(name, {
                    downTs: ev.ts,
                    modifiers: [...heldModifiers],
                    focusTitle: lastFocus?.windowTitle || null,
                });
            }
            continue;
        }
        if (ev.type === 'key_up') {
            const name = ev.data && ev.data.name;
            if (!name) continue;
            if (MODIFIER_KEYS.has(name)) {
                heldModifiers.delete(name);
                continue;
            }
            _flushPendingKey(name, ev.ts);
            continue;
        }
        if (ev.type === 'mouse_click') {
            // "mouse_click" from the polling source is the DOWN edge. We defer
            // classification (click vs hold vs drag) until the matching
            // mouse_up so we know duration and whether the cursor moved.
            _flushMoveBuffer();
            const button = ev.data.button || 'left';
            // Preserve the historical rule: if the press occurs within 500ms
            // of a focus change, treat it as the "click that switched focus"
            // and drop it entirely (both press and its future up).
            if (ev.ts - lastFocusTs < 500) {
                lastClickTs = ev.ts;
                continue;
            }
            if (!pendingPress.has(button)) {
                pendingPress.set(button, {
                    downTs: ev.ts,
                    downX: ev.data.x,
                    downY: ev.data.y,
                    focusTitle: lastFocus?.windowTitle || null,
                    movesInside: [],
                });
            }
            lastCursor = { x: ev.data.x, y: ev.data.y };
            continue;
        }
        if (ev.type === 'mouse_up') {
            const button = ev.data.button || 'left';
            const press = pendingPress.get(button);
            lastCursor = { x: ev.data.x, y: ev.data.y };
            if (!press) continue; // orphan up — press was dropped (focus-window rule).
            pendingPress.delete(button);
            _emitMousePress(press, button, ev.ts, ev.data.x, ev.data.y, false);
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

    // Flush any keys still held when the recording ended — emit as taps since
    // we never observed the release edge and can't measure a real duration.
    for (const name of Array.from(pendingKeys.keys())) {
        _flushPendingKey(name, null);
    }
    // Any mouse press without a matching mouse_up (older recordings that don't
    // include mouse_up events, or recordings stopped mid-click) → emit as a
    // simple click_at at the down position. `orphaned=true` skips drag/hold
    // classification since we can't measure duration reliably.
    for (const [button, press] of Array.from(pendingPress.entries())) {
        pendingPress.delete(button);
        _emitMousePress(press, button, press.downTs, press.downX, press.downY, true);
    }
    _flushMoveBuffer();

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
