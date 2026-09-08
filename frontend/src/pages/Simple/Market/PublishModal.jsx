import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { listAddonSkills, previewSkillScrub, previewSkillCapabilities } from '../../../services/simpleAddonApi.js';
import { publishMarketSkill } from '../../../services/marketplaceApi.js';

const CATEGORY_SEVERITY = ['safe-read', 'sandboxed-write', 'shell', 'destructive', 'system'];

function severityOf(category) {
  const i = CATEGORY_SEVERITY.indexOf(category);
  return i === -1 ? CATEGORY_SEVERITY.length : i;
}

// Mirrors the category badge classes in Market.jsx (shared CSS in Market.css).
function catClass(category) {
  const sev = severityOf(category);
  if (sev >= 4) return 'mkt-cat mkt-cat--system';
  if (sev === 3) return 'mkt-cat mkt-cat--destructive';
  if (sev === 2) return 'mkt-cat mkt-cat--shell';
  if (sev === 1) return 'mkt-cat mkt-cat--write';
  return 'mkt-cat mkt-cat--read';
}

/** Lowercase + sanitize to the backend's slug rule: ^[a-z0-9][a-z0-9_-]{0,99}$ */
function slugify(input) {
  const s = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+/, '');
  return s.slice(0, 100);
}

/**
 * PublishModal — publish a local skill to the marketplace.
 *
 * Source is either a skill listed by the connected addon, or pasted JSON.
 * Publishing is gated on a local preview pass (scrub + capabilities) so the
 * user sees "what will be shared" before anything is sent (doc §6.1/§4.5).
 */
export default function PublishModal({ token, addonConnected, onClose, onPublished }) {
  const [source, setSource] = useState(addonConnected ? 'addon' : 'paste');
  const [skills, setSkills] = useState([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [skillsError, setSkillsError] = useState('');
  const [selectedSlug, setSelectedSlug] = useState('');
  const [pastedJson, setPastedJson] = useState('');

  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoriesText, setCategoriesText] = useState('');

  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const loadSkills = async () => {
    setLoadingSkills(true);
    setSkillsError('');
    try {
      const res = await listAddonSkills();
      const list = (res?.skills || []).filter((s) => s?.skill && Array.isArray(s.skill.steps));
      setSkills(list);
      if (list.length > 0) {
        setSelectedSlug(list[0].skill.slug);
        setName(list[0].skill.name || '');
        setSlug(slugify(list[0].skill.slug || list[0].skill.name));
        setCategoriesText((list[0].skill.declaredCategories || []).join(', '));
      }
    } catch (err) {
      setSkillsError(err.message);
    } finally {
      setLoadingSkills(false);
    }
  };

  useEffect(() => {
    if (source === 'addon' && addonConnected) loadSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, addonConnected]);

  /** Resolve the current skill object from whichever source is selected. */
  const currentSkill = () => {
    if (source === 'addon') {
      return skills.find((s) => s.skill?.slug === selectedSlug)?.skill || null;
    }
    if (!pastedJson.trim()) return null;
    try {
      const parsed = JSON.parse(pastedJson);
      const sk = parsed?.skill || parsed;
      const candidate = Array.isArray(sk) ? sk[0] : sk;
      return candidate && Array.isArray(candidate.steps) ? candidate : null;
    } catch {
      return null;
    }
  };

  const selectSkill = (value) => {
    setSelectedSlug(value);
    const sk = skills.find((s) => s.skill?.slug === value)?.skill;
    if (sk) {
      setName(sk.name || '');
      setSlug(slugify(sk.slug || sk.name));
      setCategoriesText((sk.declaredCategories || []).join(', '));
    }
    setPreview(null);
    setResult(null);
  };

  const onPasteChange = (value) => {
    setPastedJson(value);
    setPreview(null);
    setResult(null);
  };

  const doPreview = async () => {
    const sk = currentSkill();
    if (!sk) {
      setError('Select a skill or paste valid skill JSON first.');
      return;
    }
    setError('');
    setResult(null);
    setPreviewBusy(true);
    try {
      const [scrub, caps] = await Promise.all([
        previewSkillScrub(sk),
        previewSkillCapabilities(sk),
      ]);
      setPreview({ scrubbed: scrub.skill, report: scrub.report, capabilities: caps });
    } catch (err) {
      setError(err.message);
    } finally {
      setPreviewBusy(false);
    }
  };

  const doPublish = async () => {
    if (!preview) {
      setError('Preview first — publishing requires reviewing what will be shared.');
      return;
    }
    const finalSlug = slugify(slug || currentSkill()?.slug || currentSkill()?.name);
    if (!finalSlug) {
      setError('A valid slug is required (lowercase letters/digits/underscore/hyphen).');
      return;
    }
    if (!name.trim()) {
      setError('A name is required.');
      return;
    }
    setError('');
    setPublishBusy(true);
    try {
      const declaredCategories = categoriesText
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      const res = await publishMarketSkill(token, {
        slug: finalSlug,
        name: name.trim(),
        steps: preview.scrubbed.steps,
        params: preview.scrubbed.params || [],
        declaredCategories,
        toolSchemaVersion: currentSkill()?.toolSchemaVersion ?? null,
        naturalLanguageDescription: description.trim() || '',
      });
      setResult(res);
      toast.success(`Published "${res.skill?.name || name.trim()}" v${res.version}`);
      if (onPublished) onPublished(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishBusy(false);
    }
  };

  const findings = preview?.report?.findings || [];
  const caps = preview?.capabilities || null;

  return (
    <div className="mkt-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mkt-modal mkt-modal--publish" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="mkt-modal-close" onClick={onClose} aria-label="Close">×</button>

        <div className="mkt-modal-head">
          <h2>Publish a skill</h2>
          <p className="mkt-modal-slug">Share your automation with the marketplace.</p>
        </div>

        {/* Source selection */}
        <div className="mkt-pub-source">
          <button
            type="button"
            className={`mkt-btn ${source === 'addon' ? 'mkt-btn--secondary' : 'mkt-btn--ghost'}`}
            disabled={!addonConnected}
            onClick={() => setSource('addon')}
          >
            From the addon
          </button>
          <button
            type="button"
            className={`mkt-btn ${source === 'paste' ? 'mkt-btn--secondary' : 'mkt-btn--ghost'}`}
            onClick={() => setSource('paste')}
          >
            Paste JSON
          </button>
        </div>

        {source === 'addon' && (
          <div className="mkt-pub-picker">
            {loadingSkills && <p className="mkt-hint">Loading your skills…</p>}
            {skillsError && <p className="mkt-hint mkt-hint--error">{skillsError}</p>}
            {!loadingSkills && !skillsError && skills.length === 0 && (
              <p className="mkt-hint">
                No skills found on the addon. Record a skill in the addon first, or paste JSON.
              </p>
            )}
            {!loadingSkills && skills.length > 0 && (
              <select
                value={selectedSlug}
                onChange={(e) => selectSkill(e.target.value)}
                aria-label="Choose a skill to publish"
              >
                {skills.map((s) => (
                  <option key={s.skill.slug} value={s.skill.slug}>
                    {s.skill.name || s.skill.slug} (@{s.skill.slug})
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {source === 'paste' && (
          <textarea
            className="mkt-pub-json"
            value={pastedJson}
            onChange={(e) => onPasteChange(e.target.value)}
            placeholder='Paste a skill object, e.g. {"slug":"my-skill","name":"My Skill","steps":[…]}'
            rows={5}
            aria-label="Paste skill JSON"
          />
        )}

        {/* Metadata form */}
        <div className="mkt-pub-form">
          <label className="mkt-pub-field">
            <span>Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Organize my downloads" />
          </label>
          <label className="mkt-pub-field">
            <span>Slug</span>
            <input type="text" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="organize-downloads" />
          </label>
          <label className="mkt-pub-field">
            <span>Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this skill do, in plain language?"
              rows={2}
            />
          </label>
          <label className="mkt-pub-field">
            <span>Categories (comma-separated)</span>
            <input
              type="text"
              value={categoriesText}
              onChange={(e) => setCategoriesText(e.target.value)}
              placeholder="safe-read, system"
            />
          </label>
        </div>

        {error && <p className="mkt-hint mkt-hint--error">{error}</p>}

        {/* Preview */}
        {preview && (
          <div className="mkt-pub-preview">
            <h4>What will be shared</h4>
            {findings.length === 0 ? (
              <p className="mkt-hint">Nothing sensitive detected — no redactions needed.</p>
            ) : (
              <div className="mkt-warning mkt-warning--low">
                <strong>{findings.length} redaction{findings.length === 1 ? '' : 's'} applied:</strong>
                <ul className="mkt-pub-findings">
                  {findings.map((f, i) => (
                    <li key={i}>
                      step {f.step} · {f.field} · {f.kind}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {caps && (
              <div className="mkt-capability">
                <h4>What this skill will do</h4>
                {Array.isArray(caps.summary) && caps.summary.length > 0 && (
                  <ul className="mkt-capability-list">
                    {caps.summary.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
                {Array.isArray(caps.actualCategories) && caps.actualCategories.length > 0 && (
                  <div className="mkt-capability-cats">
                    {caps.actualCategories.map((c) => (
                      <span key={c} className={catClass(c)}>{c}</span>
                    ))}
                  </div>
                )}
                {Array.isArray(caps.mismatches) && caps.mismatches.length > 0 && (
                  <div className="mkt-warning mkt-warning--mismatch">
                    <strong>Declared/actual mismatch:</strong>{' '}
                    {caps.mismatches.map((m) => `${m.tool} → ${m.category}`).join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="mkt-pub-result">
            <p className="mkt-installed-ok">✓ Published v{result.version} ({result.isNewSkill ? 'new skill' : 'new version'})</p>
            <p className="mkt-hint">
              marketId: <code>{result.marketId}</code>
            </p>
          </div>
        )}

        <div className="mkt-modal-actions">
          {!result ? (
            <>
              <button type="button" className="mkt-btn mkt-btn--secondary" onClick={doPreview} disabled={previewBusy}>
                {previewBusy ? 'Previewing…' : 'Preview'}
              </button>
              <button
                type="button"
                className="mkt-btn mkt-btn--primary"
                onClick={doPublish}
                disabled={!preview || publishBusy}
              >
                {publishBusy ? 'Publishing…' : 'Publish'}
              </button>
            </>
          ) : (
            <button type="button" className="mkt-btn mkt-btn--primary" onClick={onClose}>Done</button>
          )}
        </div>

        {!result && !preview && (
          <p className="mkt-hint mkt-pub-gate-hint">
            Publish unlocks after you run <strong>Preview</strong> and review what will be shared.
          </p>
        )}
      </div>
    </div>
  );
}
