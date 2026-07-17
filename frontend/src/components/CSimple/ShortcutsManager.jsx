/**
 * ShortcutsManager
 *
 * Adv-settings tab that lets the user record, edit, delete, run, and
 * globally hotkey-bind desktop macros (a.k.a. "skills"). Macros are stored
 * in the cloud workspace (kind='skill') so they sync across devices; the
 * connected local addon owns recording and hotkey registration.
 *
 * Requirements at runtime:
 *   - `user.token` (JWT) for cloud CRUD
 *   - `addonConnected` (boolean) — needed to record/run/bind hotkeys
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listWorkspace,
  getWorkspaceItem,
  upsertWorkspaceItem,
  deleteWorkspaceItem,
  startRecording,
  stopRecording,
  getRecorderStatus,
  compileSkill,
  saveSkill,
  runSkill,
  syncSkillHotkeys,
  compileNaturalMacro,
  remountAutomation,
  compileMacroNaturalViaBackend,
  editMacroNatural,
  editMacroNaturalViaBackend,
} from '../../services/csimpleApi';
import './ShortcutsManager.css';

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,99}$/;
// Match the addon's acceptable modifier set — must be kept in sync with
// server/automation/skill-hotkeys.js MODIFIERS.
const MODIFIER_KEYS = new Set([
  'Control', 'Ctrl', 'Alt', 'Shift', 'Meta', 'Command', 'CommandOrControl',
]);
// Print-friendly labels for special keys captured from `event.key`.
const SPECIAL_KEY_LABEL = {
  ' ': 'Space', Spacebar: 'Space',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Escape: 'Escape', Enter: 'Return', Tab: 'Tab', Backspace: 'Backspace',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown',
};

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'macro';
}

/** Convert a KeyboardEvent → Electron accelerator string. */
function acceleratorFromEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('CommandOrControl');
  else if (e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  const key = e.key;
  if (!key || MODIFIER_KEYS.has(key)) return null; // waiting for a real key
  if (SPECIAL_KEY_LABEL[key]) parts.push(SPECIAL_KEY_LABEL[key]);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) parts.push(key.toUpperCase());
  else if (key.length === 1) parts.push(key.toUpperCase());
  else return null;

  // Require at least one non-shift modifier so bindings can't hijack plain keys.
  const hasNonShift = parts.some(p => p !== 'Shift' && p !== parts[parts.length - 1]);
  if (!hasNonShift) return null;
  return parts.join('+');
}

/** Parse a stored skill JSON blob out of a workspace item's content. */
function parseSkillContent(item) {
  if (!item) return null;
  try {
    return typeof item.content === 'string' ? JSON.parse(item.content) : (item.content || null);
  } catch {
    return null;
  }
}

/** Format a millisecond duration as e.g. "850ms" or "4.2s". */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function asAddonConnectionErrorMessage(message) {
  const m = String(message || '');
  const lower = m.toLowerCase();
  const isNetwork = lower.includes('failed to fetch')
    || lower.includes('networkerror')
    || lower.includes('load failed')
    || lower.includes('network request failed');
  if (!isNetwork) return m || 'Run failed';
  return 'Lost connection to CSimple addon. Make sure the addon is running, then try again.';
}

/** Human-friendly summary of a compiled skill's step list. */
function summarizeSteps(skill) {
  const steps = skill?.steps || [];
  if (!steps.length) return 'No steps';
  const byTool = new Map();
  for (const s of steps) byTool.set(s.tool, (byTool.get(s.tool) || 0) + 1);
  return [...byTool.entries()]
    .map(([tool, n]) => (n === 1 ? tool : `${tool}×${n}`))
    .join(', ');
}

export default function ShortcutsManager({ user, addonConnected, githubToken }) {
  const token = user?.token;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [macros, setMacros] = useState([]); // [{ item, skill }]

  // Macro-run tracking: shown as a dedicated banner that stays visible for
  // the FULL run (doesn't vanish instantly) and reports total duration plus
  // which step failed, if any. Separate from the generic `status` flash so
  // unrelated actions (save/compile/delete) can't clobber it mid-run.
  const [runInfo, setRunInfo] = useState(null);
  const [showRunDebug, setShowRunDebug] = useState(false);

  // Recorder state
  const [recorder, setRecorder] = useState({ active: false, eventCount: 0, startedAt: null });
  const [pendingName, setPendingName] = useState('');
  const [recorderBusy, setRecorderBusy] = useState(false);

  // Natural language compiler state
  const [nlText, setNlText] = useState('');
  const [nlName, setNlName] = useState('');
  const [nlBusy, setNlBusy] = useState(false);
  const [nlResult, setNlResult] = useState(null); // { steps, meta }

  // Editor state — null unless a macro is open for editing.
  const [editor, setEditor] = useState(null);
  const [editorBusy, setEditorBusy] = useState(false);
  // Natural-language edit ("press z after the shift click") inside the editor dialog.
  const [editNlText, setEditNlText] = useState('');
  const [editNlBusy, setEditNlBusy] = useState(false);
  const [captureFor, setCaptureFor] = useState(null); // slug currently binding a hotkey

  const captureRef = useRef(null);

  // Poll recorder status every 1s while active so the event count updates.
  useEffect(() => {
    if (!addonConnected) return;
    let cancelled = false;
    let timer = null;
    async function tick() {
      try {
        const st = await getRecorderStatus();
        if (cancelled) return;
        setRecorder({
          active: !!st.active,
          eventCount: st.eventCount || 0,
          startedAt: st.startedAt || null,
          sessionId: st.sessionId || null,
        });
      } catch { /* addon dropped */ }
      if (!cancelled) timer = setTimeout(tick, 1000);
    }
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [addonConnected]);

  const loadMacros = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const list = await listWorkspace(token, { kind: 'skill' });
      const items = list.entries || [];
      // Fetch full content for each (needed for step summary + stored hotkey).
      const full = await Promise.all(items.map(async (it) => {
        try {
          const one = await getWorkspaceItem(token, 'skill', it.slug);
          return { item: one || it, skill: parseSkillContent(one) };
        } catch {
          return { item: it, skill: null };
        }
      }));
      setMacros(full);
    } catch (e) {
      setError(e.message || 'Failed to load macros');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadMacros(); }, [loadMacros]);

  // Sync the current hotkey map to the addon whenever the macro list changes.
  useEffect(() => {
    if (!addonConnected) return;
    const hotkeys = macros
      .map(({ item, skill }) => ({ slug: item.slug, accelerator: skill?.hotkey || null }))
      .filter(h => h.accelerator);
    syncSkillHotkeys(hotkeys).catch(() => { /* non-fatal */ });
  }, [macros, addonConnected]);

  const flashStatus = useCallback((text, ms = 3000) => {
    setStatus(text);
    if (ms > 0) setTimeout(() => setStatus(cur => (cur === text ? null : cur)), ms);
  }, []);

  // Tick the elapsed-time display once per 100ms while a macro is running.
  useEffect(() => {
    if (!runInfo || runInfo.phase !== 'running') return undefined;
    const id = setInterval(() => {
      setRunInfo(cur => (cur && cur.phase === 'running'
        ? { ...cur, elapsedMs: Date.now() - cur.startedAt }
        : cur));
    }, 100);
    return () => clearInterval(id);
  }, [runInfo?.phase, runInfo?.startedAt]);

  // ── Recording pipeline ─────────────────────────────────────────────────
  const handleStartRecording = useCallback(async () => {
    if (!addonConnected) return;
    setRecorderBusy(true);
    setError(null);
    try {
      const name = pendingName.trim() || `macro-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
      await startRecording(name);
      flashStatus(`Recording "${name}"…`, 0);
    } catch (e) {
      setError(e.message || 'Failed to start recording');
    } finally {
      setRecorderBusy(false);
    }
  }, [addonConnected, pendingName, flashStatus]);

  const handleStopRecording = useCallback(async () => {
    if (!addonConnected) return;
    setRecorderBusy(true);
    setError(null);
    try {
      const stopped = await stopRecording();
      const sessionId = stopped.sessionId;
      const rawName = pendingName.trim() || sessionId.replace(/-\d+$/, '');
      // Compile → save (local + cloud). Slug uniqueness enforced server-side.
      const compiled = await compileSkill({ sessionId, name: rawName });
      const skill = compiled?.skill;
      if (!skill) throw new Error('Compile returned empty skill');
      // Preserve hotkey if the user re-recorded an existing macro (same slug).
      const existing = macros.find(m => m.item.slug === skill.slug);
      if (existing?.skill?.hotkey) skill.hotkey = existing.skill.hotkey;
      await saveSkill(skill);
      // Persist to cloud too (saveSkill already tries, but be explicit for slug/name/hotkey visibility).
      if (token) {
        const tags = skill.hotkey ? [`hotkey:${skill.hotkey}`] : [];
        await upsertWorkspaceItem(token, 'skill', skill.slug, {
          name: skill.name || skill.slug,
          content: JSON.stringify(skill),
          tags,
        });
      }
      setPendingName('');
      flashStatus(`Saved "${skill.name}" (${stopped.eventCount} events)`);
      await loadMacros();
    } catch (e) {
      setError(e.message || 'Failed to stop / save recording');
    } finally {
      setRecorderBusy(false);
    }
  }, [addonConnected, pendingName, macros, token, flashStatus, loadMacros]);

  // ── Natural language compiler ──────────────────────────────────────────
  const handleCompileNl = useCallback(async () => {
    if (!nlText.trim()) return;
    setNlBusy(true);
    setNlResult(null);
    setError(null);

    const applyResult = (result) => {
      setNlResult(result);
      if (!nlName.trim()) {
        const derived = nlText.trim().slice(0, 40).replace(/[^a-zA-Z0-9 ]/g, '').trim();
        setNlName(derived || 'nl-macro');
      }
      flashStatus(`Compiled ${result.steps?.length || 0} steps${result.meta?.via === 'backend' ? ' (cloud)' : ''}`);
    };

    try {
      // Tier 1: Try local addon directly — pass githubToken so the addon doesn't
      // need to find it in settings.json (avoids DPAPI issues on fresh dev runs).
      if (addonConnected) {
        try {
          const result = await compileNaturalMacro(nlText.trim(), { githubToken });
          applyResult(result);
          return;
        } catch (addonErr) {
          const msg = addonErr.message || '';
          const isRouteError = msg.includes('Cannot POST') || msg.includes('404') || msg.includes('compile-natural') || msg.includes('remount');
          if (isRouteError) {
            // Tier 2: Auto-heal addon routes and retry
            try {
              flashStatus('Reconnecting addon routes…', 0);
              await remountAutomation();
              const result2 = await compileNaturalMacro(nlText.trim(), { githubToken });
              applyResult(result2);
              return;
            } catch {
              // Fall through to backend
            }
          } else {
            // Non-route error (LLM error, validation, etc) — rethrow to show proper message
            throw addonErr;
          }
        }
      }

      // Tier 3: Backend cloud compiler (works without addon, requires login + GitHub PAT)
      if (token) {
        flashStatus('Using cloud compiler…', 0);
        const result3 = await compileMacroNaturalViaBackend(token, nlText.trim());
        applyResult(result3);
        return;
      }

      throw new Error(
        addonConnected
          ? 'Addon routes unavailable. Quit and relaunch the addon from the system tray.'
          : 'Sign in to use cloud macro compilation, or install the CSimple addon.'
      );
    } catch (e) {
      setError(e.message || 'Compile failed');
    } finally {
      setNlBusy(false);
    }
  }, [nlText, nlName, addonConnected, token, githubToken, flashStatus]);

  const handleSaveNl = useCallback(async () => {
    if (!nlResult || !token) return;
    setNlBusy(true);
    setError(null);
    try {
      const name = (nlName.trim() || 'nl-macro').slice(0, 80);
      const slug = slugify(name);
      const skill = {
        slug,
        name,
        description: nlText.trim().slice(0, 200),
        steps: nlResult.steps,
        metadata: {
          source: 'nl-compiler',
          compiledAt: nlResult.meta?.compiledAt || new Date().toISOString(),
        },
      };
      await upsertWorkspaceItem(token, 'skill', slug, {
        name,
        content: JSON.stringify(skill),
        tags: ['nl-compiled'],
      });
      if (addonConnected) {
        try { await saveSkill(skill); } catch { /* non-fatal */ }
      }
      flashStatus(`Saved macro "${name}" (${skill.steps.length} steps)`);
      setNlText('');
      setNlName('');
      setNlResult(null);
      await loadMacros();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setNlBusy(false);
    }
  }, [nlResult, nlText, nlName, token, addonConnected, flashStatus, loadMacros]);

  // ── Row actions ────────────────────────────────────────────────────────
  const handleRun = useCallback(async (slug) => {
    if (!addonConnected) return;
    setError(null);
    const startedAt = Date.now();
    setShowRunDebug(false);
    setRunInfo({ slug, phase: 'running', startedAt, elapsedMs: 0 });
    try {
      // Pass the inline skill so the addon can execute without needing to
      // resolve it from the workspace API (works after addon restart / no auth).
      const macro = macros.find(m => m.item.slug === slug);
      const out = await runSkill(slug, {}, macro?.skill || null);
      const elapsedMs = Date.now() - startedAt;
      // The addon's tool-registry ALWAYS wraps a tool's return value as
      // { ok, result, error, mode, durationMs } (see tool-registry.js
      // executeTool) — `out.error` here is a registry-level failure (unknown
      // tool, permission denied, uncaught throw), and the actual skill_run
      // summary { steps, failed, stepsTotal, stepsRun } lives under
      // `out.result`, NOT flat on `out`. Reading the wrong level here
      // previously made every run report "done (0/0 steps)" regardless of
      // what actually happened.
      if (out?.error) throw new Error(out.error);
      const summary = out?.result || {};
      const steps = summary.steps || [];
      const failedStep = steps.find(s => s.error);
      const failed = !!summary.failed || !!failedStep;
      setRunInfo({
        slug,
        phase: failed ? 'failed' : 'done',
        startedAt,
        elapsedMs,
        stepsTotal: summary.stepsTotal ?? steps.length,
        stepsRun: summary.stepsRun ?? steps.length,
        failedStep: failedStep
          ? {
            index: failedStep.index,
            tool: failedStep.tool,
            error: failedStep.error,
            args: failedStep.args,
            compatibility: failedStep.compatibility,
            repairs: failedStep.repairs,
            result: failedStep.result,
          }
          : null,
        rawSummary: summary,
      });
    } catch (e) {
      const elapsedMs = Date.now() - startedAt;
      const msg = asAddonConnectionErrorMessage(e?.message);
      setRunInfo({ slug, phase: 'failed', startedAt, elapsedMs, error: msg });
      setError(msg);
    }
  }, [addonConnected, macros]);

  const handleDelete = useCallback(async (slug) => {
    if (!token) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete macro "${slug}"? This is a soft delete (30-day recovery).`)) return;
    setError(null);
    try {
      await deleteWorkspaceItem(token, 'skill', slug);
      flashStatus(`Deleted "${slug}"`);
      await loadMacros();
    } catch (e) {
      setError(e.message || 'Delete failed');
    }
  }, [token, flashStatus, loadMacros]);

  const openEditor = useCallback(({ item, skill }) => {
    setEditNlText('');
    setEditor({
      originalSlug: item.slug,
      slug: item.slug,
      name: skill?.name || item.name || item.slug,
      description: skill?.description || '',
      hotkey: skill?.hotkey || '',
      stepsJson: JSON.stringify(skill?.steps || [], null, 2),
      skill,
      expectedUpdatedAt: item.updatedAt || null,
    });
  }, []);

  const saveEditor = useCallback(async () => {
    if (!editor || !token) return;
    setEditorBusy(true);
    setError(null);
    try {
      if (!SLUG_RE.test(editor.slug)) {
        throw new Error('Slug must be lowercase alphanumeric with - or _, 1–100 chars, starting with letter/digit.');
      }
      let steps;
      try { steps = JSON.parse(editor.stepsJson); }
      catch (e) { throw new Error(`Steps JSON is invalid: ${e.message}`); }
      if (!Array.isArray(steps)) throw new Error('Steps must be a JSON array');
      const updated = {
        ...(editor.skill || {}),
        slug: editor.slug,
        name: editor.name || editor.slug,
        description: editor.description || '',
        hotkey: editor.hotkey || undefined,
        steps,
        metadata: {
          ...(editor.skill?.metadata || {}),
          updatedAt: new Date().toISOString(),
        },
      };
      // If the slug changed, delete the old workspace entry after writing the new one.
      const slugChanged = editor.originalSlug && editor.originalSlug !== editor.slug;
      const tags = updated.hotkey ? [`hotkey:${updated.hotkey}`] : [];
      await upsertWorkspaceItem(token, 'skill', updated.slug, {
        name: updated.name,
        content: JSON.stringify(updated),
        tags,
        expectedUpdatedAt: slugChanged ? undefined : editor.expectedUpdatedAt,
      });
      if (slugChanged) {
        try { await deleteWorkspaceItem(token, 'skill', editor.originalSlug); } catch { /* soft delete may 404 if already gone */ }
      }
      // Also refresh addon-local cache so run works immediately without a cloud roundtrip.
      if (addonConnected) {
        try { await saveSkill(updated); } catch { /* non-fatal */ }
      }
      flashStatus(`Saved "${updated.name}"`);
      setEditor(null);
      await loadMacros();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setEditorBusy(false);
    }
  }, [editor, token, addonConnected, flashStatus, loadMacros]);

  // ── Natural-language macro editing ──────────────────────────────────────
  // Lets the user describe a change to an already-open macro in plain
  // English (e.g. "press z after the shift click") instead of hand-editing
  // the raw steps JSON. Reuses the same addon → auto-heal → cloud fallback
  // tiers as the "create from scratch" NL compiler above.
  const handleEditWithNl = useCallback(async () => {
    if (!editor || !editNlText.trim()) return;
    setEditNlBusy(true);
    setError(null);
    try {
      let currentSteps;
      try { currentSteps = JSON.parse(editor.stepsJson); }
      catch (e) { throw new Error(`Steps JSON is invalid: ${e.message}`); }
      if (!Array.isArray(currentSteps) || currentSteps.length === 0) {
        throw new Error('Add at least one step before using natural-language edits.');
      }
      const instruction = editNlText.trim();

      const applyResult = (result) => {
        setEditor(cur => (cur ? { ...cur, stepsJson: JSON.stringify(result.steps, null, 2) } : cur));
        setEditNlText('');
        flashStatus(`Updated to ${result.steps?.length || 0} steps${result.meta?.via === 'backend' ? ' (cloud)' : ''}`);
      };

      // Tier 1: local addon
      if (addonConnected) {
        try {
          const result = await editMacroNatural(currentSteps, instruction, { githubToken });
          applyResult(result);
          return;
        } catch (addonErr) {
          const msg = addonErr.message || '';
          const isRouteError = msg.includes('Cannot POST') || msg.includes('404') || msg.includes('edit-natural') || msg.includes('remount');
          if (isRouteError) {
            try {
              flashStatus('Reconnecting addon routes…', 0);
              await remountAutomation();
              const result2 = await editMacroNatural(currentSteps, instruction, { githubToken });
              applyResult(result2);
              return;
            } catch {
              // Fall through to backend
            }
          } else {
            throw addonErr;
          }
        }
      }

      // Tier 2: backend cloud editor
      if (token) {
        flashStatus('Using cloud editor…', 0);
        const result3 = await editMacroNaturalViaBackend(token, currentSteps, instruction);
        applyResult(result3);
        return;
      }

      throw new Error(
        addonConnected
          ? 'Addon routes unavailable. Quit and relaunch the addon from the system tray.'
          : 'Sign in to use cloud macro editing, or install the CSimple addon.'
      );
    } catch (e) {
      setError(e.message || 'Edit failed');
    } finally {
      setEditNlBusy(false);
    }
  }, [editor, editNlText, addonConnected, token, githubToken, flashStatus]);

  // ── Hotkey capture (keydown handler bound while `captureFor` is set) ──
  useEffect(() => {
    if (!captureFor) return;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const accel = acceleratorFromEvent(e);
      if (!accel) return; // waiting for a real key
      // Detect conflicts locally before pushing.
      const conflict = macros.find(m => m.item.slug !== captureFor && m.skill?.hotkey === accel);
      if (conflict) {
        setError(`${accel} is already bound to "${conflict.item.name || conflict.item.slug}"`);
        setCaptureFor(null);
        return;
      }
      if (captureFor === '__editor__') {
        // Bind inside the open editor dialog only; user must Save to persist.
        setEditor(cur => (cur ? { ...cur, hotkey: accel } : cur));
        setCaptureFor(null);
        return;
      }
      // Bind directly on a list row.
      (async () => {
        try {
          const target = macros.find(m => m.item.slug === captureFor);
          if (!target?.skill) throw new Error('Macro not found');
          const updated = { ...target.skill, hotkey: accel };
          const tags = [`hotkey:${accel}`];
          await upsertWorkspaceItem(token, 'skill', target.item.slug, {
            name: updated.name || target.item.slug,
            content: JSON.stringify(updated),
            tags,
            expectedUpdatedAt: target.item.updatedAt,
          });
          if (addonConnected) { try { await saveSkill(updated); } catch { /* cache refresh */ } }
          flashStatus(`Bound ${accel} → ${updated.name || target.item.slug}`);
          await loadMacros();
        } catch (err) {
          setError(err.message || 'Failed to bind hotkey');
        } finally {
          setCaptureFor(null);
        }
      })();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [captureFor, macros, token, addonConnected, flashStatus, loadMacros]);

  const clearHotkey = useCallback(async ({ item, skill }) => {
    if (!token || !skill) return;
    setError(null);
    try {
      const updated = { ...skill };
      delete updated.hotkey;
      await upsertWorkspaceItem(token, 'skill', item.slug, {
        name: updated.name || item.slug,
        content: JSON.stringify(updated),
        tags: [],
        expectedUpdatedAt: item.updatedAt,
      });
      if (addonConnected) { try { await saveSkill(updated); } catch { /* non-fatal */ } }
      flashStatus(`Cleared hotkey for "${updated.name || item.slug}"`);
      await loadMacros();
    } catch (e) {
      setError(e.message || 'Failed to clear hotkey');
    }
  }, [token, addonConnected, flashStatus, loadMacros]);

  // Focus the capture prompt input when opened, so Escape cancels reliably.
  useEffect(() => {
    if (captureFor && captureRef.current) captureRef.current.focus();
  }, [captureFor]);

  const rows = useMemo(() => {
    return [...macros].sort((a, b) => {
      const an = (a.skill?.name || a.item.name || a.item.slug).toLowerCase();
      const bn = (b.skill?.name || b.item.name || b.item.slug).toLowerCase();
      return an.localeCompare(bn);
    });
  }, [macros]);

  if (!token) {
    return (
      <div className="short__empty">
        Sign in to record and manage keyboard macros.
      </div>
    );
  }

  return (
    <div className="short">
      <div className="short__intro">
        <p className="short__intro-title">Keyboard Macros</p>
        <p className="short__intro-desc">
          Record desktop actions and bind them to global keyboard shortcuts. Macros are stored in your
          cloud workspace and run through the CSimple addon on this machine.
        </p>
        {!addonConnected && (
          <p className="short__banner short__banner--warn">
            ⚠ Local CSimple addon not connected — recording and running macros are disabled.
          </p>
        )}
      </div>

      {/* Recorder */}
      <div className="short__group">
        <div className="short__group-header">
          <span className="short__group-title">Recorder</span>
          {recorder.active && (
            <span className="short__rec-indicator" aria-live="polite">
              <span className="short__rec-dot" /> Recording · {recorder.eventCount} events
            </span>
          )}
        </div>
        <div className="short__recorder">
          <input
            type="text"
            className="adv-input short__name-input"
            placeholder="Macro name (optional)"
            value={pendingName}
            onChange={e => setPendingName(e.target.value)}
            disabled={recorder.active || recorderBusy}
          />
          {!recorder.active ? (
            <button
              className="short__btn short__btn--primary"
              onClick={handleStartRecording}
              disabled={!addonConnected || recorderBusy}
            >
              ● Start recording
            </button>
          ) : (
            <button
              className="short__btn short__btn--danger"
              onClick={handleStopRecording}
              disabled={recorderBusy}
            >
              ■ Stop & save
            </button>
          )}
        </div>
        <p className="short__hint">
          After starting, perform the actions you want captured. Recording covers mouse clicks, focus changes,
          and typed text. Click <b>Stop &amp; save</b> to compile into a runnable macro.
        </p>
      </div>

      {/* Natural Language Macro Compiler */}
      <div className="short__group">
        <div className="short__group-header">
          <span className="short__group-title">✨ Natural Language Macro</span>
          <span className="short__group-badge">AI</span>
        </div>
        <p className="short__hint">
          Describe a macro in plain English and the AI will compile it into executable steps.
          <br />Examples: <em>"mine stone in minecraft until I press Escape"</em> · <em>"open Notepad, type hello, save"</em>
        </p>
        <textarea
          className="adv-input short__nl-textarea"
          placeholder="Describe what you want the macro to do…"
          rows={3}
          value={nlText}
          onChange={e => setNlText(e.target.value)}
          disabled={nlBusy}
        />
        <div className="short__recorder" style={{ marginTop: '6px' }}>
          <input
            type="text"
            className="adv-input short__name-input"
            placeholder="Macro name (optional)"
            value={nlName}
            onChange={e => setNlName(e.target.value)}
            disabled={nlBusy}
          />
          <button
            className="short__btn short__btn--primary"
            onClick={handleCompileNl}
            disabled={nlBusy || !nlText.trim()}
          >
            {nlBusy ? '⏳ Compiling…' : '⚡ Compile'}
          </button>
        </div>
        {nlResult && (
          <div className="short__nl-result">
            <div className="short__nl-result-header">
              <span>{nlResult.steps?.length} steps compiled</span>
              <button
                className="short__btn short__btn--primary"
                onClick={handleSaveNl}
                disabled={nlBusy || !token}
              >
                💾 Save macro
              </button>
            </div>
            <pre className="short__nl-preview">
              {JSON.stringify(nlResult.steps, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Status / error banners */}
      {error && (
        <div className="short__banner short__banner--err" role="alert" onClick={() => setError(null)}>
          {error} <span className="short__banner-dismiss">✕</span>
        </div>
      )}
      {status && (
        <div className="short__banner short__banner--info" role="status">
          {status}
        </div>
      )}
      {runInfo && (
        <div
          className={`short__banner short__run short__run--${runInfo.phase}`}
          role="status"
        >
          <span>
            {runInfo.phase === 'running' && (
              <><span className="short__run-spinner" aria-hidden="true" /> Running "{runInfo.slug}"… {formatDuration(runInfo.elapsedMs)}</>
            )}
            {runInfo.phase === 'done' && (
              <>✓ "{runInfo.slug}" done in {formatDuration(runInfo.elapsedMs)} ({runInfo.stepsRun}/{runInfo.stepsTotal} steps)</>
            )}
            {runInfo.phase === 'failed' && runInfo.failedStep && (
              <>
                ✕ "{runInfo.slug}" failed at step {runInfo.failedStep.index + 1}/{runInfo.stepsTotal} ({runInfo.failedStep.tool}) after {formatDuration(runInfo.elapsedMs)}: {runInfo.failedStep.error}
                <button
                  type="button"
                  className="short__run-debug-toggle"
                  onClick={() => setShowRunDebug(v => !v)}
                >
                  {showRunDebug ? 'Hide debug details' : 'Show debug details'}
                </button>
              </>
            )}
            {runInfo.phase === 'failed' && !runInfo.failedStep && (
              <>✕ "{runInfo.slug}" failed after {formatDuration(runInfo.elapsedMs)}{runInfo.error ? `: ${runInfo.error}` : ''}</>
            )}
          </span>
          {runInfo.phase !== 'running' && (
            <span className="short__banner-dismiss" onClick={() => setRunInfo(null)}>✕</span>
          )}
        </div>
      )}
      {runInfo?.phase === 'failed' && runInfo.failedStep && showRunDebug && (
        <pre className="short__run-debug" role="status">
          {JSON.stringify({
            slug: runInfo.slug,
            failedStep: runInfo.failedStep,
          }, null, 2)}
        </pre>
      )}

      {/* Capture prompt */}
      {captureFor && (
        <div className="short__capture" onClick={() => setCaptureFor(null)}>
          <div className="short__capture-body" onClick={e => e.stopPropagation()}>
            <p className="short__capture-title">Press the keyboard shortcut…</p>
            <p className="short__capture-hint">Include at least one non-shift modifier (Ctrl, Alt, or Meta). Escape to cancel.</p>
            <input
              ref={captureRef}
              type="text"
              className="adv-input short__capture-input"
              readOnly
              placeholder="Waiting for keypress…"
              onKeyDown={e => { if (e.key === 'Escape') setCaptureFor(null); }}
            />
          </div>
        </div>
      )}

      {/* Macro list */}
      <div className="short__group">
        <div className="short__group-header">
          <span className="short__group-title">Your macros ({rows.length})</span>
          <button className="short__btn short__btn--muted" onClick={loadMacros} disabled={loading}>Refresh</button>
        </div>
        {loading ? (
          <div className="short__empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="short__empty">No macros yet. Record one above to get started.</div>
        ) : (
          <ul className="short__list">
            {rows.map(({ item, skill }) => {
              const name = skill?.name || item.name || item.slug;
              const hotkey = skill?.hotkey;
              const summary = skill ? summarizeSteps(skill) : 'Content unavailable';
              const stepCount = skill?.steps?.length || 0;
              return (
                <li key={item.slug} className="short__item">
                  <div className="short__item-main">
                    <div className="short__item-title">
                      <span className="short__item-name">{name}</span>
                      <span className="short__item-slug">/{item.slug}</span>
                    </div>
                    <div className="short__item-meta">
                      <span className="short__item-steps">{stepCount} step{stepCount === 1 ? '' : 's'}</span>
                      <span className="short__item-sep">·</span>
                      <span className="short__item-summary" title={summary}>{summary}</span>
                    </div>
                    <div className="short__item-hotkey">
                      {hotkey ? (
                        <span className="short__kbd">{hotkey}</span>
                      ) : (
                        <span className="short__no-hotkey">No hotkey</span>
                      )}
                      <button
                        className="short__link"
                        onClick={() => setCaptureFor(item.slug)}
                        disabled={!skill}
                        title="Bind a global keyboard shortcut"
                      >
                        {hotkey ? 'Change' : 'Bind'}
                      </button>
                      {hotkey && (
                        <button
                          className="short__link short__link--muted"
                          onClick={() => clearHotkey({ item, skill })}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="short__item-actions">
                    <button
                      className="short__btn short__btn--sm"
                      onClick={() => handleRun(item.slug)}
                      disabled={!addonConnected || !skill}
                      title={!addonConnected ? 'Connect the addon to run macros' : 'Run now'}
                    >
                      ▶ Run
                    </button>
                    <button
                      className="short__btn short__btn--sm short__btn--muted"
                      onClick={() => openEditor({ item, skill })}
                      disabled={!skill}
                    >
                      Edit
                    </button>
                    <button
                      className="short__btn short__btn--sm short__btn--danger-ghost"
                      onClick={() => handleDelete(item.slug)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Editor dialog */}
      {editor && (
        <div className="short__editor-overlay" onClick={() => !editorBusy && setEditor(null)}>
          <div className="short__editor" onClick={e => e.stopPropagation()}>
            <div className="short__editor-header">
              <h3 className="short__editor-title">Edit macro</h3>
              <button className="short__editor-close" onClick={() => setEditor(null)} disabled={editorBusy}>✕</button>
            </div>
            <div className="short__editor-body">
              <label className="short__field">
                <span className="short__field-label">Name</span>
                <input
                  type="text"
                  className="adv-input"
                  value={editor.name}
                  onChange={e => setEditor({ ...editor, name: e.target.value })}
                />
              </label>
              <label className="short__field">
                <span className="short__field-label">Slug</span>
                <input
                  type="text"
                  className="adv-input"
                  value={editor.slug}
                  onChange={e => setEditor({ ...editor, slug: slugify(e.target.value) })}
                />
                <span className="short__field-hint">Renaming the slug creates a new record and soft-deletes the old one.</span>
              </label>
              <label className="short__field">
                <span className="short__field-label">Description</span>
                <input
                  type="text"
                  className="adv-input"
                  value={editor.description}
                  onChange={e => setEditor({ ...editor, description: e.target.value })}
                />
              </label>
              <div className="short__field">
                <span className="short__field-label">Global hotkey</span>
                <div className="short__hotkey-row">
                  {editor.hotkey ? (
                    <span className="short__kbd">{editor.hotkey}</span>
                  ) : (
                    <span className="short__no-hotkey">Not bound</span>
                  )}
                  <button
                    className="short__link"
                    type="button"
                    onClick={() => setCaptureFor('__editor__')}
                  >
                    {editor.hotkey ? 'Change' : 'Bind'}
                  </button>
                  {editor.hotkey && (
                    <button
                      className="short__link short__link--muted"
                      type="button"
                      onClick={() => setEditor({ ...editor, hotkey: '' })}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <label className="short__field">
                <span className="short__field-label">Modify with AI</span>
                <div className="short__nl-edit-row">
                  <input
                    type="text"
                    className="adv-input"
                    placeholder='e.g. "press z after the shift click"'
                    value={editNlText}
                    onChange={e => setEditNlText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !editNlBusy) { e.preventDefault(); handleEditWithNl(); } }}
                    disabled={editNlBusy}
                  />
                  <button
                    className="short__btn short__btn--sm short__btn--primary"
                    type="button"
                    onClick={handleEditWithNl}
                    disabled={editNlBusy || !editNlText.trim()}
                  >
                    {editNlBusy ? 'Applying…' : 'Apply'}
                  </button>
                </div>
                <span className="short__field-hint">
                  Describe the change in plain English — it rewrites the steps below for you to review before saving.
                </span>
              </label>
              <label className="short__field">
                <span className="short__field-label">Steps (JSON)</span>
                <textarea
                  className="short__editor-textarea"
                  value={editor.stepsJson}
                  onChange={e => setEditor({ ...editor, stepsJson: e.target.value })}
                  spellCheck={false}
                  rows={12}
                />
                <span className="short__field-hint">
                  Advanced: edit compiled tool calls directly. Each step is <code>{'{ tool, args }'}</code>.
                </span>
              </label>
            </div>
            <div className="short__editor-footer">
              <button
                className="short__btn short__btn--muted"
                onClick={() => setEditor(null)}
                disabled={editorBusy}
              >
                Cancel
              </button>
              <button
                className="short__btn short__btn--primary"
                onClick={saveEditor}
                disabled={editorBusy}
              >
                {editorBusy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
