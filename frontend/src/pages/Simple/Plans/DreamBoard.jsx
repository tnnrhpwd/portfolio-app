/**
 * DreamBoard.jsx — the Dream board view of /plans.
 *
 * A board of the user's goals rendered as tiles: cover image, the aspiration in
 * their own words, where it's headed, and how far the agent has got. It's a
 * *view over the same goal store* rather than a separate feature — every tile is
 * an ordinary goal, so a dream can be handed to the agent ("Enlist agent") and
 * the run's progress shows up on the tile. That's the whole reason it lives on
 * /plans instead of being its own page: a dream board you can't act on is a
 * poster, and this one is a to-do list with pictures.
 *
 * Covers, in the order most people will use them:
 *   1. a preset from `dreamCovers.js` (no cost, instant, always there);
 *   2. their own photo, uploaded to S3 via the presigned flow;
 *   3. an image URL they paste (including one /net just generated for them);
 *   4. an AI-generated cover built from the goal's own title + vision line.
 *
 * Every goal gets a tile even if it has never chosen a cover — one is borrowed
 * deterministically from its slug (`coverSource`). A board of placeholders reads
 * as broken, and asking someone to pick a picture before they can see their
 * board is the wrong order.
 *
 * Service page rules apply (FRONTEND_UI_STANDARD.md §5.7): panels are planes of
 * colour with no borders, no scroll reveals, and the copy is labels rather than
 * sentences.
 */

import { useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import {
  upsertWorkspaceItem,
  generateCoverImage,
  uploadCoverImage,
  uploadCoverDataUrl,
  deleteCoverImage,
} from '../../../services/workspaceApi';
import {
  DREAM_FILTERS,
  DREAM_VISION_MAX,
  PRIORITY_LABELS,
  dreamCoverPrompt,
  dreamTargetLabel,
  dreamTiles,
  dreamVision,
  hasBeenEnlisted,
  isAgentReady,
  slugifyGoalTitle,
  priorityToNumber,
  timeSince,
} from './plansUtils';
import { DREAM_COVERS, coverSource } from './dreamCovers';
import { downscaleImageFile } from './dreamBoardUtils';
import './DreamBoard.css';

const PRIORITY_OPTIONS = ['low', 'medium', 'high'];

/** A blank create form. */
function emptyDreamForm() {
  return {
    slug: '',
    title: '',
    vision: '',
    targetDate: '',
    priority: 'medium',
    cover: '',
    description: '',
    successCriteria: '',
    maxSteps: '',
    autoAbandon: false,
  };
}

/** Populate the form from an existing goal. */
function formFromGoal(item) {
  const d = item?.data || {};
  return {
    slug: item?._id || '',
    title: d.title || '',
    vision: d.vision || '',
    targetDate: d.targetDate || '',
    priority: d.priority || 'medium',
    cover: d.cover || '',
    description: d.description || '',
    successCriteria: d.successCriteria || '',
    maxSteps: d.maxSteps != null ? String(d.maxSteps) : '',
    autoAbandon: !!d.autoAbandon,
  };
}

// -- Board --------------------------------------------------------------------

function DreamBoard({
  goals,
  token,
  loading,
  onChanged,
  onDelete,
  onStatusChange,
  onOpen,
  onEnlist,
  onViewAgent,
  enlisting,
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState(null);
  // Cover objects this form session uploaded, so an abandoned form can clean up
  // after itself instead of leaving them on the user's storage bill.
  const uploadsRef = useRef([]);

  const tiles = useMemo(() => dreamTiles(goals, filter, search), [goals, filter, search]);
  const hasFilters = Boolean(search) || filter !== 'all';
  const achievedCount = useMemo(
    () => (goals || []).filter((g) => g?.data?.status === 'done' || g?.data?.status === 'completed').length,
    [goals],
  );

  const openCreate = () => { uploadsRef.current = []; setForm(emptyDreamForm()); };
  const openEdit = (item) => { uploadsRef.current = []; setForm(formFromGoal(item)); };

  const save = async (e) => {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) { toast.error('Give your dream a name first'); return; }
    if (!token) { toast.error('Sign in to save your board'); return; }

    const slug = form.slug || slugifyGoalTitle(title);
    try {
      await upsertWorkspaceItem(token, 'goal', slug, {
        name: title,
        // The description is the agent's context, so a dream with no description
        // falls back to the vision line rather than to the title — the vision is
        // what the user actually wrote about the outcome.
        content: form.description.trim() || form.vision.trim() || title,
        priority: priorityToNumber(form.priority),
        // `vision`/`cover`/`targetDate` are always sent, so clearing the line or
        // swapping the picture actually sticks (the server treats a mentioned
        // key as authoritative). `status` is deliberately NOT sent for an
        // existing goal: it's changed from the tile, and a full save must never
        // quietly reset it.
        vision: form.vision.trim(),
        cover: form.cover.trim(),
        targetDate: form.targetDate,
        ...(form.successCriteria.trim() ? { successCriteria: form.successCriteria.trim() } : {}),
        ...(form.maxSteps.trim() ? { maxSteps: Number(form.maxSteps) } : {}),
        ...(form.autoAbandon ? { autoAbandon: true } : {}),
      });
      toast.success(form.slug ? 'Dream updated' : 'Dream added to your board');
      // Anything the picker uploaded that the goal no longer points at is an
      // orphan now — discard it rather than leaving it on the user's bill.
      discardUploads({ keep: form.cover.trim() });
      setForm(null);
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  };

  /**
   * Delete the covers this form session uploaded and no longer needs.
   *
   * @param {object} [opts]
   * @param {string} [opts.keep] - Cover URL that survived a save; every other
   *   upload from the session is an orphan
   * @param {boolean} [opts.all] - Discard every upload (the form was abandoned)
   */
  const discardUploads = ({ keep, all } = {}) => {
    const session = uploadsRef.current || [];
    uploadsRef.current = [];
    for (const entry of session) {
      if (!all && entry.url === keep) continue;
      deleteCoverImage(token, entry.s3Key, entry.recordId);
    }
  };

  /** Close without saving — nothing from this session is referenced. */
  const closeForm = () => {
    discardUploads({ all: true });
    setForm(null);
  };

  return (
    <section className="dream" aria-label="Dream board">
      {/* The board's own controls. The page toolbar keeps the title and live
          state; creation belongs here, next to the board it creates into. */}
      <div className="plans-controls dream-controls">
        <div className="dream-controls-row">
          <div className="plans-search">
            <span className="plans-search-icon" aria-hidden="true">🔍</span>
            <input
              className="plans-search-input"
              type="text"
              placeholder="Search your board…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search dreams"
            />
            {search && (
              <button type="button" className="plans-search-clear" onClick={() => setSearch('')} aria-label="Clear search">✕</button>
            )}
          </div>

          <div className="plans-chips">
            {DREAM_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`plans-chip ${filter === f.key ? 'is-active' : ''}`}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
              >
                {f.label}{f.key === 'achieved' && achievedCount > 0 ? ` ${achievedCount}` : ''}
              </button>
            ))}
            {hasFilters && (
              <button
                type="button"
                className="plans-chip plans-chip--clear"
                onClick={() => { setSearch(''); setFilter('all'); }}
              >
                ✕ Clear
              </button>
            )}
          </div>

          <button type="button" className="plans-btn plans-btn--primary dream-new" onClick={openCreate}>
            + New dream
          </button>
        </div>
      </div>

      {form && (
        <DreamForm
          form={form}
          setForm={setForm}
          token={token}
          uploadsRef={uploadsRef}
          onSave={save}
          onCancel={closeForm}
        />
      )}

      {loading ? (
        <div className="plans-skeleton-list" aria-label="Loading">
          {[0, 1, 2, 3].map((i) => (
            <div className="plans-skeleton-card" key={i}>
              <div className="plans-skeleton plans-skeleton--title" />
              <div className="plans-skeleton plans-skeleton--line" />
            </div>
          ))}
        </div>
      ) : tiles.length === 0 ? (
        <div className="plans-empty">
          <div className="plans-empty-icon" aria-hidden="true">🌟</div>
          <p className="plans-empty-title">
            {hasFilters
              ? 'Nothing on your board matches that'
              : 'Your board is empty — add the first thing you’re aiming at'}
          </p>
          {hasFilters ? (
            <button type="button" className="plans-btn plans-btn--ghost" onClick={() => { setSearch(''); setFilter('all'); }}>
              Clear filters
            </button>
          ) : (
            <button type="button" className="plans-btn plans-btn--primary" onClick={openCreate}>
              + New dream
            </button>
          )}
        </div>
      ) : (
        <div className="dream-grid">
          {tiles.map((item) => (
            <DreamTile
              key={item._id}
              item={item}
              enlisting={enlisting}
              onOpen={onOpen}
              onEdit={openEdit}
              onDelete={onDelete}
              onStatusChange={onStatusChange}
              onEnlist={onEnlist}
              onViewAgent={onViewAgent}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// -- Tile ---------------------------------------------------------------------

function DreamTile({ item, enlisting, onOpen, onEdit, onDelete, onStatusChange, onEnlist, onViewAgent }) {
  const d = item.data || {};
  const status = d.status || 'active';
  const achieved = status === 'done' || status === 'completed';
  const { src, preset } = coverSource(d.cover, item._id);
  const vision = dreamVision(item);
  const target = dreamTargetLabel(d.targetDate, status);
  const enlisted = hasBeenEnlisted(item);
  // An achieved or paused dream is not work the agent should be handed, so it
  // gets a quiet way to look at it instead of a primary "Enlist" button — same
  // rule the goal card follows.
  const ready = isAgentReady(item);

  return (
    <article
      className={`dream-tile status-${status} ${achieved ? 'is-achieved' : ''}`}
      style={{ '--dream-hue': preset?.hue || 'var(--fg-blue)' }}
    >
      <button
        type="button"
        className="dream-tile-media"
        onClick={() => onOpen(item)}
        aria-label={`Open ${d.title || 'dream'}`}
      >
        {src
          ? (
            <img
              src={src}
              alt=""
              loading="lazy"
              // A pasted link can rot and an upload can be deleted out from under
              // a tile. Hiding the element drops the tile back to its hued plane,
              // which reads as a deliberate block of colour — a browser's broken
              // image icon does not.
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )
          : <span className="dream-tile-nocover" aria-hidden="true" />}
        {achieved && <span className="dream-tile-badge">✓ Achieved</span>}
      </button>

      <div className="dream-tile-body">
        <div className="dream-tile-head">
          <button
            type="button"
            className={`plans-goal-check ${achieved ? 'is-checked' : ''}`}
            onClick={() => onStatusChange(item, achieved ? 'active' : 'done')}
            title={achieved ? 'Mark as still in flight' : 'Mark as achieved'}
            aria-label={achieved ? 'Mark as still in flight' : 'Mark as achieved'}
          >
            {achieved ? '✓' : ''}
          </button>
          <h3 className="dream-tile-title">{d.title || 'Untitled dream'}</h3>
        </div>

        {vision && <p className="dream-tile-vision">{vision}</p>}
      </div>

      <div className="dream-tile-tags">
        {target && <span className={`plans-tag ${d.targetDate && /overdue/i.test(target) ? 'plans-tag--danger' : ''}`}>{target}</span>}
        {d.priority && d.priority !== 'low' && (
          <span className={`plans-tag plans-tag--${d.priority}`}>{PRIORITY_LABELS[d.priority] || d.priority}</span>
        )}
        {enlisted && <span className="plans-tag plans-tag--outline">agent has run</span>}
        <span className="dream-tile-time">{timeSince(item.updatedAt)}</span>
      </div>

      <footer className="dream-tile-foot">
        {enlisted ? (
          <button
            type="button"
            className="plans-btn plans-btn--primary plans-btn--sm"
            onClick={() => onViewAgent(item)}
            title="Open this dream's conversation on /net"
          >
            👁 View agent
          </button>
        ) : ready ? (
          <button
            type="button"
            className="plans-btn plans-btn--primary plans-btn--sm"
            onClick={() => onEnlist(item)}
            disabled={enlisting === item._id}
            title="Hand this dream to the agent in its own conversation on /net"
          >
            {enlisting === item._id ? '🤖 Enlisting…' : '🤖 Enlist agent'}
          </button>
        ) : (
          <button type="button" className="plans-btn plans-btn--ghost plans-btn--sm" onClick={() => onOpen(item)}>
            View summary
          </button>
        )}

        <div className="dream-tile-tools">
          <button type="button" className="plans-icon-btn" onClick={() => onEdit(item)} title="Edit dream" aria-label="Edit dream">✎</button>
          <button type="button" className="plans-icon-btn plans-icon-btn--danger" onClick={() => onDelete(item)} title="Delete" aria-label="Delete dream">×</button>
        </div>
      </footer>
    </article>
  );
}

// -- Create / edit form -------------------------------------------------------

function DreamForm({ form, setForm, token, uploadsRef, onSave, onCancel }) {
  const [busy, setBusy] = useState(null);   // 'generating' | 'uploading' | null
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  /** Swap the cover, keeping the previous value so a failed upload can revert. */
  const pickCover = (value) => set({ cover: value });

  /** Remember an uploaded object so the board can delete it if it goes unused. */
  const trackUpload = (uploaded) => {
    if (uploaded?.s3Key) uploadsRef.current = [...(uploadsRef.current || []), uploaded];
  };

  const handleGenerate = async () => {
    const prompt = dreamCoverPrompt({ title: form.title, vision: form.vision });
    if (!prompt) { toast.error('Write a name or a line about the dream first'); return; }
    const previous = form.cover;
    setBusy('generating');
    try {
      const { dataUrl } = await generateCoverImage(token, prompt);
      pickCover(dataUrl);          // show it immediately — no waiting on S3
      setBusy('uploading');
      const uploaded = await uploadCoverDataUrl(token, dataUrl);
      trackUpload(uploaded);
      pickCover(uploaded.url);
      toast.success('Cover made from your words');
    } catch (err) {
      // A `data:` cover can't be saved (the goal's whole content is capped at
      // 16 KB), so never leave one behind on failure.
      pickCover(previous);
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    const previous = form.cover;
    setBusy('uploading');
    try {
      const { blob, filename, wasResized } = await downscaleImageFile(file);
      const uploaded = await uploadCoverImage(token, blob, { filename });
      trackUpload(uploaded);
      pickCover(uploaded.url);
      toast.success(wasResized ? 'Photo added — resized to save your storage' : 'Photo added');
    } catch (err) {
      pickCover(previous);
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleUrl = () => {
    const url = urlDraft.trim();
    if (!/^https?:\/\//i.test(url)) { toast.error('That needs to be a full http(s) image link'); return; }
    pickCover(url);
    setUrlDraft('');
  };

  const submit = async (e) => {
    setSaving(true);
    try { await onSave(e); } finally { setSaving(false); }
  };

  const chosen = coverSource(form.cover, form.slug || form.title);
  const isPresetChosen = Boolean(form.cover) && !chosen.isCustom;

  return (
    <form className="plans-form dream-form" onSubmit={submit}>
      <div className="plans-form-head">
        <h2 className="plans-form-title">{form.slug ? 'Edit dream' : 'New dream'}</h2>
        <button type="button" className="plans-form-close" onClick={onCancel} aria-label="Close form">✕</button>
      </div>

      <div className="dream-form-cols">
        <div className="dream-form-fields">
          <label className="plans-field">
            <span className="plans-field-label">What are you aiming at?</span>
            <input
              className="plans-input"
              type="text"
              placeholder="e.g. Run a half marathon"
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              autoFocus
              maxLength={200}
            />
          </label>

          <label className="plans-field">
            <span className="plans-field-label">
              Your words
              <span className="plans-field-hint"> — the line that goes on the tile</span>
            </span>
            <textarea
              className="plans-textarea"
              placeholder="e.g. Cross the line feeling strong, with my family watching"
              value={form.vision}
              onChange={(e) => set({ vision: e.target.value })}
              rows={3}
              maxLength={DREAM_VISION_MAX}
            />
            <span className="plans-field-hint dream-count">{form.vision.length}/{DREAM_VISION_MAX}</span>
          </label>

          <div className="plans-form-row">
            <label className="plans-field">
              <span className="plans-field-label">By when <span className="plans-field-hint">optional</span></span>
              <input
                className="plans-input"
                type="date"
                value={form.targetDate}
                onChange={(e) => set({ targetDate: e.target.value })}
              />
            </label>
            <label className="plans-field">
              <span className="plans-field-label">Priority</span>
              <select
                className="plans-select"
                value={form.priority}
                onChange={(e) => set({ priority: e.target.value })}
              >
                {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
              </select>
            </label>
          </div>

          <label className="plans-field">
            <span className="plans-field-label">
              Notes for the agent
              <span className="plans-field-hint"> — optional context for planning</span>
            </span>
            <textarea
              className="plans-textarea"
              placeholder="Where it lives, what “done” looks like…"
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              rows={2}
              maxLength={1000}
            />
          </label>

          <div className="plans-advanced">
            <button
              type="button"
              className="plans-advanced-toggle"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
            >
              {showAdvanced ? '▾' : '▸'} Agent settings <span className="plans-field-hint">optional</span>
            </button>
            {showAdvanced && (
              <div className="plans-advanced-body">
                <label className="plans-field">
                  <span className="plans-field-label">Success criteria</span>
                  <input
                    className="plans-input"
                    type="text"
                    placeholder="e.g. A window titled 'Report' is focused and the file exists"
                    value={form.successCriteria}
                    onChange={(e) => set({ successCriteria: e.target.value })}
                    maxLength={300}
                  />
                </label>
                <div className="plans-form-row">
                  <label className="plans-field">
                    <span className="plans-field-label">Step budget</span>
                    <input
                      className="plans-input"
                      type="number"
                      min={1}
                      max={1000}
                      placeholder="60"
                      value={form.maxSteps}
                      onChange={(e) => set({ maxSteps: e.target.value })}
                    />
                  </label>
                  <label className="plans-field plans-field--check">
                    <input
                      type="checkbox"
                      checked={form.autoAbandon}
                      onChange={(e) => set({ autoAbandon: e.target.checked })}
                    />
                    <span>Let the agent give up if it keeps stalling</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        <CoverPicker
          form={form}
          preset={chosen.preset}
          isPresetChosen={isPresetChosen}
          isCustomChosen={chosen.isCustom}
          busy={busy}
          urlDraft={urlDraft}
          setUrlDraft={setUrlDraft}
          onPick={pickCover}
          onGenerate={handleGenerate}
          onUrl={handleUrl}
          onUploadClick={() => fileRef.current?.click()}
          fileRef={fileRef}
          onFile={handleUpload}
          token={token}
        />
      </div>

      <div className="plans-form-actions">
        <button type="button" className="plans-btn plans-btn--ghost" onClick={onCancel} disabled={saving || Boolean(busy)}>
          Cancel
        </button>
        <button
          type="submit"
          className="plans-btn plans-btn--primary"
          disabled={saving || Boolean(busy) || !form.title.trim()}
        >
          {saving ? 'Saving…' : form.slug ? 'Save changes' : 'Put it on my board'}
        </button>
      </div>
    </form>
  );
}

// -- Cover picker -------------------------------------------------------------

/**
 * The four ways to give a tile a picture, in one panel.
 *
 * Presets lead because they cost nothing and always work; the other three are
 * progressively more effort and more personal. Only the preset grid is visible
 * by default — the rest sit behind a disclosure so the common path stays one
 * click and the form stays short.
 */
function CoverPicker({
  form, preset, isPresetChosen, isCustomChosen, busy, urlDraft, setUrlDraft,
  onPick, onGenerate, onUrl, onUploadClick, fileRef, onFile, token,
}) {
  const [showMore, setShowMore] = useState(false);
  const current = preset?.art || (isCustomChosen ? form.cover : null);

  return (
    <div className="plans-field dream-cover">
      <span className="plans-field-label">Cover</span>

      {/* A live preview, so every choice above lands somewhere visible. */}
      <div
        className="dream-cover-preview"
        style={{ '--dream-hue': preset?.hue || 'var(--fg-blue)' }}
      >
        {current
          ? (
            <img
              src={current}
              alt=""
              // Same graceful degradation as a tile: a link that has rotted
              // shows the hued plane rather than a broken-image glyph.
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )
          : <span className="dream-tile-nocover" aria-hidden="true" />}
        {busy && (
          <span className="dream-cover-busy">
            {busy === 'generating' ? '✧ Making your cover…' : 'Uploading…'}
          </span>
        )}
      </div>

      <div className="dream-cover-grid" role="radiogroup" aria-label="Preset covers">
        {DREAM_COVERS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={isPresetChosen && preset?.key === c.key}
            aria-label={c.label}
            title={c.label}
            className={`dream-cover-choice ${isPresetChosen && preset?.key === c.key ? 'is-active' : ''}`}
            onClick={() => onPick(c.key)}
            disabled={Boolean(busy)}
          >
            <img src={c.art} alt="" loading="lazy" />
          </button>
        ))}
      </div>

      <button
        type="button"
        className="plans-advanced-toggle dream-cover-more"
        onClick={() => setShowMore((v) => !v)}
        aria-expanded={showMore}
      >
        {showMore ? '▾' : '▸'} Use your own picture
      </button>

      {showMore && (
        <div className="dream-cover-custom">
          <button
            type="button"
            className="plans-btn plans-btn--outline plans-btn--sm"
            onClick={onUploadClick}
            disabled={Boolean(busy) || !token}
          >
            {busy === 'uploading' ? 'Uploading…' : '⬆ Upload a photo'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={onFile}
            className="dream-cover-file"
            aria-label="Upload a cover photo"
            tabIndex={-1}
          />

          <button
            type="button"
            className="plans-btn plans-btn--outline plans-btn--sm"
            onClick={onGenerate}
            disabled={Boolean(busy) || !token}
            title="Uses your AI credits and takes about ten seconds"
          >
            {busy === 'generating' ? '✧ Making…' : '✨ Make one from my words'}
          </button>

          <div className="dream-cover-url">
            <input
              className="plans-input"
              type="url"
              placeholder="…or paste an image link"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onUrl(); } }}
              aria-label="Paste an image link"
            />
            <button type="button" className="plans-btn plans-btn--ghost plans-btn--sm" onClick={onUrl} disabled={!urlDraft.trim()}>
              Use link
            </button>
          </div>
          <p className="plans-field-hint">
            Covers you upload or generate are stored in your cloud storage and count toward your plan.
          </p>
        </div>
      )}
    </div>
  );
}

export default DreamBoard;
