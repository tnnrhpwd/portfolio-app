/**
 * VisionBoards.jsx — the generated picture of a life, and the ones before it.
 *
 * Two things live here and they are deliberately in one component, because they
 * are the same feature seen at two moments:
 *
 *   • the MAKE dialog — "which goals should it be made from?", asked *before*
 *     anything is spent, since a board costs an image credit (and, on a bad day,
 *     the answer changes what gets drawn);
 *   • the HISTORY — the boards already made, newest first, each labelled with
 *     what it came from. A board you can't look back at is a one-off image, not a
 *     board.
 *
 * The button that opens the dialog sits with the board's own controls (`+ New
 * dream`), in DreamBoard, because that is where the user is looking when they
 * think of it — this component owns the dialog and the gallery.
 *
 * The generation itself is server-side and arrives already stored: the chat model
 * writes the image prompt, the image model draws it, the picture goes to S3 and
 * the board is saved to the account. Nothing here uploads anything, which is why
 * a board still exists if the tab is closed mid-flight.
 *
 * Service-page rules apply (FRONTEND_UI_STANDARD.md §5.7): glass panes, no
 * borders, labels over sentences, and the artwork is the only colour.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { generateVisionBoards, listVisionBoards, deleteVisionBoard } from '../../../services/visionBoardApi.js';
import { timeSince } from './plansUtils.js';
import {
  BOARD_SCOPES,
  SCOPE_LABELS,
  SCOPE_SHORT,
  boardCountLabel,
  boardMetaLine,
  costLine,
  parseBoards,
  resultLine,
  scopeGlyph,
  toggleScope,
} from './visionBoardUtils.js';
import './VisionBoards.css';

/** Thumbnails shown before the strip asks whether you want the rest. */
const STRIP_MAX = 6;
const HINT_MAX = 200;

export default function VisionBoards({
  token,
  dreamCount = 0,
  allCount = 0,
  open = false,
  onOpenChange,
}) {
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [making, setMaking] = useState(false);
  const [scopes, setScopes] = useState(['dream']);
  const [hint, setHint] = useState('');
  const [error, setError] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // Boards whose image failed to load (a deleted object, a rotted URL). Tracked
  // rather than hidden: a board with no picture is exactly the one you want to
  // delete, so it stays in the strip and says so.
  const [deadUrls, setDeadUrls] = useState({});

  const load = useCallback(async () => {
    if (!token) { setBoards([]); setLoading(false); return; }
    try {
      const entries = await listVisionBoards(token);
      setBoards(parseBoards(entries));
    } catch {
      // A gallery that can't load is an empty gallery — never an error state on
      // a view whose main job is the board of dreams below it.
      setBoards([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Opening the dialog re-picks the default scope: asking for a Dreams board when
  // there are no Life-horizon goals yet would only ever be skipped server-side.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setHint('');
    setScopes(dreamCount ? ['dream'] : allCount ? ['all'] : ['dream']);
  }, [open, dreamCount, allCount]);

  // Escape closes whichever layer is up, innermost first.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (confirming) { if (!deleting) setConfirming(null); return; }
      if (viewing) { setViewing(null); return; }
      if (open && !making) onOpenChange?.(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming, deleting, viewing, open, making, onOpenChange]);

  const counts = useMemo(() => ({ dreamCount, allCount }), [dreamCount, allCount]);

  const make = async () => {
    if (!token || making || !scopes.length) return;
    setMaking(true);
    setError(null);
    try {
      const res = await generateVisionBoards(token, scopes, { hint: hint.trim() });
      // Reload rather than splice: the server decides the slug, and the strip must
      // show what was actually saved even if a scope was skipped.
      await load();
      const line = resultLine(res);
      if (res.boards.length) {
        toast.success(line);
        onOpenChange?.(false);
      } else {
        // Nothing made (no goals in scope) — keep the dialog open so the choice
        // can be changed, and say why.
        setError({ message: line });
      }
    } catch (e) {
      setError(e);
    } finally {
      setMaking(false);
    }
  };

  const remove = async (board) => {
    if (!token || !board || deleting) return;
    setDeleting(true);
    try {
      await deleteVisionBoard(token, board.slug);
      setBoards((prev) => prev.filter((b) => b.slug !== board.slug));
      setConfirming(null);
      setViewing(null);
      toast.success('Board deleted');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
    }
  };

  const visible = showAll ? boards : boards.slice(0, STRIP_MAX);
  const hidden = Math.max(0, boards.length - visible.length);

  return (
    <>
      {/* ── The history ─────────────────────────────────────────────────── */}
      {(loading || boards.length > 0) && (
        <section className="vb" aria-label="Vision boards">
          <header className="vb-head">
            <h2 className="vb-title">🖼️ Vision boards</h2>
            <span className="vb-meta">
              {loading ? 'Loading…' : boardMetaLine(boards[0], { ago: timeSince(boards[0].generatedAt) })}
            </span>
            <span className="vb-badge">{loading ? '' : boardCountLabel(boards.length)}</span>
          </header>

          <div className="vb-strip">
            {visible.map((board) => {
              const dead = deadUrls[board.url];
              return (
                <figure className="vb-card" key={board.slug}>
                  <button
                    type="button"
                    className="vb-card-media"
                    onClick={() => setViewing(board)}
                    aria-label={`Open ${board.name} from ${SCOPE_LABELS[board.scope]}`}
                  >
                    {dead ? (
                      <span className="vb-card-dead" aria-hidden="true">🖼️ gone</span>
                    ) : (
                      <img
                        src={board.url}
                        alt={boardMetaLine(board)}
                        loading="lazy"
                        onError={() => setDeadUrls((prev) => ({ ...prev, [board.url]: true }))}
                      />
                    )}
                    <span className="vb-card-scope" aria-hidden="true">
                      {scopeGlyph(board.scope)} {SCOPE_SHORT[board.scope]}
                    </span>
                  </button>
                  <figcaption className="vb-card-meta">
                    {boardMetaLine(board, { ago: timeSince(board.generatedAt) })}
                  </figcaption>
                </figure>
              );
            })}

            {hidden > 0 && (
              <button type="button" className="vb-more" onClick={() => setShowAll(true)}>
                +{hidden} older
              </button>
            )}
            {showAll && boards.length > STRIP_MAX && (
              <button type="button" className="vb-more" onClick={() => setShowAll(false)}>
                Show latest
              </button>
            )}
          </div>
        </section>
      )}

      {/* ── The make dialog ─────────────────────────────────────────────── */}
      {open && (
        <div
          className="plans-modal-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !making) onOpenChange?.(false); }}
        >
          <div
            className="plans-modal vb-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vb-make-title"
          >
            <span className="plans-modal-icon" aria-hidden="true">🖼️</span>
            <h2 id="vb-make-title" className="plans-modal-title">Make a vision board</h2>
            <p className="plans-modal-desc">
              One picture of the life you&apos;re aiming at. The AI reads your goals, writes the
              image prompt, and draws it — in a new look every time — then it&apos;s saved here so you
              can look back at it.
            </p>

            <fieldset className="vb-scopes">
              <legend className="vb-scopes-legend">Made from</legend>
              {BOARD_SCOPES.map((scope) => {
                const count = scope === 'dream' ? dreamCount : allCount;
                const checked = scopes.includes(scope);
                return (
                  <label className={`vb-scope${checked ? ' is-on' : ''}${count ? '' : ' is-empty'}`} key={scope}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!count || making}
                      onChange={() => setScopes((prev) => toggleScope(prev, scope))}
                    />
                    <span className="vb-scope-name">
                      <span aria-hidden="true">{scopeGlyph(scope)}</span> {SCOPE_LABELS[scope]}
                    </span>
                    <span className="vb-scope-note">
                      {count ? `${count} goal${count === 1 ? '' : 's'}` : 'nothing here yet'}
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <label className="plans-field vb-hint">
              <span className="plans-field-label">
                Anything to add?
                <span className="plans-field-hint"> — optional, steers the picture</span>
              </span>
              <input
                className="plans-input"
                type="text"
                value={hint}
                maxLength={HINT_MAX}
                disabled={making}
                placeholder="e.g. coastal, vivid colour, no people"
                onChange={(e) => setHint(e.target.value)}
              />
            </label>

            {/* The look is the thing users notice first, and the thing they complain
                about when every board comes back the same. Said here so nobody has to
                guess whether the sameness is on purpose — and so the way to ask for a
                look again is discoverable rather than folklore. */}
            <p className="vb-defaults">
              Each board gets <strong>its own look</strong> — golden warmth, bright and airy, vivid
              colour, coastal light, evening city — picked fresh so no two come back alike. Name one
              above to ask for it.
            </p>

            {/* Both defaults, and the fact that they can be switched — an
                instruction the user can't discover is one they'll assume is a bug
                when the board comes back without the people they wanted. */}
            <p className="vb-defaults">
              Made as a <strong>vision and dream board</strong> — a photo collage of your goals — with
              <strong> no recognisable faces</strong> and <strong>no text</strong>. Ask for either
              above and it will.
            </p>

            <p className="vb-cost">{costLine(scopes, counts)}</p>

            {error && (
              <p className="vb-error" role="alert">
                {error.message}
                {' '}
                {error.upgradeUrl && <Link to={error.upgradeUrl}>See plans</Link>}
              </p>
            )}

            <div className="plans-modal-actions">
              <button
                type="button"
                className="plans-btn plans-btn--ghost"
                onClick={() => onOpenChange?.(false)}
                disabled={making}
              >
                Cancel
              </button>
              <button
                type="button"
                className="plans-btn plans-btn--primary"
                onClick={make}
                disabled={making || !scopes.length || !token}
              >
                {making ? 'Making your board…' : '✨ Make my board'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── One board, full size ────────────────────────────────────────── */}
      {viewing && (
        <div
          className="plans-modal-overlay vb-lightbox-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setViewing(null); }}
        >
          <div
            className="vb-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`${viewing.name} from ${SCOPE_LABELS[viewing.scope]}`}
          >
            {deadUrls[viewing.url] ? (
              <p className="vb-error" role="alert">
                That picture is no longer in your storage. Deleting the board clears the record too.
              </p>
            ) : (
              <img
                className="vb-light-image"
                src={viewing.url}
                alt={boardMetaLine(viewing)}
                onError={() => setDeadUrls((prev) => ({ ...prev, [viewing.url]: true }))}
              />
            )}

            <div className="vb-light-body">
              <p className="vb-light-meta">{boardMetaLine(viewing, { ago: timeSince(viewing.generatedAt) })}</p>

              {viewing.goals.length > 0 && (
                <ul className="vb-goal-chips">
                  {viewing.goals.map((goal) => (
                    <li key={goal.slug || goal.title}>
                      {goal.slug ? (
                        <Link className="vb-goal-chip" to={`/plans/goal/${encodeURIComponent(goal.slug)}`}>
                          {goal.title}
                        </Link>
                      ) : (
                        <span className="vb-goal-chip">{goal.title}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* The prompt is provenance, not decoration: without it "why does my
                  board look like that" is unanswerable a month later. */}
              {viewing.prompt && (
                <details className="vb-prompt">
                  <summary>How this picture was described</summary>
                  <p>{viewing.prompt}</p>
                </details>
              )}

              <div className="plans-modal-actions">
                <button
                  type="button"
                  className="plans-btn plans-btn--danger"
                  onClick={() => setConfirming(viewing)}
                >
                  Delete board
                </button>
                <button type="button" className="plans-btn plans-btn--ghost" onClick={() => setViewing(null)} autoFocus>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm the delete ──────────────────────────────────────────── */}
      {confirming && (
        <div
          className="plans-modal-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !deleting) setConfirming(null); }}
        >
          <div
            className="plans-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="vb-delete-title"
            aria-describedby="vb-delete-desc"
          >
            <span className="plans-modal-icon" aria-hidden="true">🗑️</span>
            <h2 id="vb-delete-title" className="plans-modal-title">Delete this vision board?</h2>
            <p id="vb-delete-desc" className="plans-modal-desc">
              The picture is removed from your storage and stops counting against your space.
              <span className="plans-modal-warn"> This can&apos;t be undone.</span>
            </p>
            <div className="plans-modal-actions">
              <button
                type="button"
                className="plans-btn plans-btn--ghost"
                onClick={() => setConfirming(null)}
                disabled={deleting}
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                className="plans-btn plans-btn--danger"
                onClick={() => remove(confirming)}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete board'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
