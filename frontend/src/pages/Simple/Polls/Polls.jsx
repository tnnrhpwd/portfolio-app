import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';
import SEO from '../../../components/SEO/SEO.jsx';
import {
  fetchPolls,
  createPoll,
  votePoll,
  closePoll,
  deletePoll,
} from '../../../services/pollsApi.js';
import './Polls.css';

// -- LocalStorage keys ---------------------------------------------------------

const VOTER_KEY = 'sthopwood_polls_voter_id';
const VOTED_PREFIX = 'sthopwood_polls_voted_';
const OWNER_PREFIX = 'sthopwood_polls_owner_';

// -- Small helpers ------------------------------------------------------------

function getVoterId() {
  let id = localStorage.getItem(VOTER_KEY);
  if (!id) {
    id = (crypto?.randomUUID?.() ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(VOTER_KEY, id);
  }
  return id;
}

function getOwnerKey(pollId) {
  return localStorage.getItem(OWNER_PREFIX + pollId) || null;
}

function setOwnerKey(pollId, key) {
  localStorage.setItem(OWNER_PREFIX + pollId, key);
}

function removeOwnerKey(pollId) {
  localStorage.removeItem(OWNER_PREFIX + pollId);
}

function getVotedOption(pollId) {
  const raw = localStorage.getItem(VOTED_PREFIX + pollId);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

function setVotedOption(pollId, idx) {
  localStorage.setItem(VOTED_PREFIX + pollId, String(idx));
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function timeLeft(expiresAt, now) {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return 'Ended';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m ${s % 60}s left`;
  return `${s}s left`;
}

// -- Configuration ------------------------------------------------------------

const DURATIONS = [
  { value: 15, label: '15 minutes' },
  { value: 60, label: '1 hour' },
  { value: 360, label: '6 hours' },
  { value: 1440, label: '1 day' },
  { value: 4320, label: '3 days' },
  { value: 10080, label: '7 days' },
];

const MAX_OPTIONS = 8;

// -- Poll card ----------------------------------------------------------------

function PollCard({
  poll,
  votedOption,
  ownerKey,
  busy,
  highlight,
  now,
  onVote,
  onClose,
  onDelete,
}) {
  const [copied, setCopied] = useState(false);
  const active = !poll.closed;
  const hasVoted = votedOption != null;

  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}?poll=${poll._id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for older browsers / non-secure contexts
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const results = (
    <div className="poll-options poll-options--results">
      {poll.options.map((opt, i) => {
        const pct = poll.totalVotes ? Math.round((opt.votes / poll.totalVotes) * 100) : 0;
        const chosen = votedOption === i;
        return (
          <div
            key={i}
            className={`poll-result${chosen ? ' poll-result--chosen' : ''}`}
          >
            <div className="poll-result__top">
              <span className="poll-result__label">{opt.text}</span>
              <span className="poll-result__pct">{pct}%</span>
            </div>
            <div className="poll-result__track">
              <div className="poll-result__fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="poll-result__votes">{opt.votes} vote{opt.votes === 1 ? '' : 's'}</span>
          </div>
        );
      })}
    </div>
  );

  const voteButtons = (
    <div className="poll-options">
      {poll.options.map((opt, i) => (
        <button
          key={i}
          type="button"
          className="poll-option"
          disabled={busy}
          onClick={() => onVote(poll, i)}
        >
          <span className="poll-option__text">{opt.text}</span>
          <span className="poll-option__arrow">→</span>
        </button>
      ))}
    </div>
  );

  return (
    <article
      id={`poll-${poll._id}`}
      className={`poll-card${highlight ? ' poll-card--highlight' : ''}${active ? '' : ' poll-card--closed'}`}
    >
      <div className="poll-card__head">
        <span className="poll-card__status">
          {active ? (
            <><span className="poll-dot poll-dot--live" /> Open</>
          ) : (
            <><span className="poll-dot poll-dot--closed" /> Closed</>
          )}
        </span>
        <span className="poll-card__time">
          {active ? timeLeft(poll.expiresAt, now) : 'Final results'}
        </span>
      </div>

      <h2 className="poll-card__question">{poll.question}</h2>

      {active && !hasVoted ? voteButtons : results}

      <div className="poll-card__foot">
        <div className="poll-card__meta">
          <span className="poll-card__author">by {poll.creator}</span>
          <span className="poll-card__sep">·</span>
          <span>{poll.totalVotes} vote{poll.totalVotes === 1 ? '' : 's'}</span>
          <span className="poll-card__sep">·</span>
          <span>{timeAgo(poll.createdAt)}</span>
        </div>
        <div className="poll-card__actions">
          <button type="button" className="poll-link-btn" onClick={copyLink}>
            {copied ? '✓ Copied' : 'Copy link'}
          </button>
          {ownerKey && active && (
            <button type="button" className="poll-owner-btn" onClick={() => onClose(poll)}>
              Close
            </button>
          )}
          {ownerKey && (
            <button type="button" className="poll-owner-btn poll-owner-btn--danger" onClick={() => onDelete(poll)}>
              Delete
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

// -- Create form --------------------------------------------------------------

function CreatePollForm({ onSubmit, submitting }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [creator, setCreator] = useState('');

  const canAdd = options.length < MAX_OPTIONS;
  const filledOptions = options.map((o) => o.trim()).filter(Boolean);
  const canSubmit = question.trim().length > 0 && filledOptions.length >= 2;

  const updateOption = (i, value) => {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  };

  const addOption = () => {
    if (canAdd) setOptions((prev) => [...prev, '']);
  };

  const removeOption = (i) => {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, idx) => idx !== i));
  };

  const submit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ question, options: filledOptions, durationMinutes, creator });
    setQuestion('');
    setOptions(['', '']);
    setDurationMinutes(60);
    setCreator('');
  };

  return (
    <form className="poll-form" onSubmit={submit}>
      <div className="poll-form__row">
        <input
          className="poll-form__question"
          type="text"
          value={question}
          maxLength={200}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question…"
          aria-label="Poll question"
        />
      </div>

      <div className="poll-form__options">
        {options.map((opt, i) => (
          <div className="poll-form__option" key={i}>
            <input
              type="text"
              value={opt}
              maxLength={80}
              onChange={(e) => updateOption(i, e.target.value)}
              placeholder={`Option ${i + 1}`}
              aria-label={`Option ${i + 1}`}
            />
            <button
              type="button"
              className="poll-form__remove"
              disabled={options.length <= 2}
              onClick={() => removeOption(i)}
              aria-label={`Remove option ${i + 1}`}
            >
              ×
            </button>
          </div>
        ))}
        {canAdd && (
          <button type="button" className="poll-form__add" onClick={addOption}>
            + Add option
          </button>
        )}
      </div>

      <div className="poll-form__row poll-form__row--split">
        <label className="poll-form__field">
          <span>Duration</span>
          <select value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))}>
            {DURATIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </label>
        <label className="poll-form__field poll-form__field--grow">
          <span>Your name (optional)</span>
          <input
            type="text"
            value={creator}
            maxLength={32}
            onChange={(e) => setCreator(e.target.value)}
            placeholder="Anonymous"
            aria-label="Your name"
          />
        </label>
      </div>

      <div className="poll-form__submit-row">
        <button type="submit" className="poll-form__submit" disabled={!canSubmit || submitting}>
          {submitting ? 'Creating…' : 'Create poll'}
        </button>
      </div>
    </form>
  );
}

// -- Main page ----------------------------------------------------------------

function Polls() {
  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyPollId, setBusyPollId] = useState(null);
  const [voted, setVoted] = useState({});
  const [ownerKeys, setOwnerKeys] = useState({});
  const [highlightId, setHighlightId] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [searchParams] = useSearchParams();

  const voterId = useMemo(getVoterId, []);

  // Load polls + hydrate local owner/vote state from localStorage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPolls();
        if (cancelled) return;
        setPolls(data);

        const votedMap = {};
        const ownerMap = {};
        data.forEach((p) => {
          const v = getVotedOption(p._id);
          if (v != null) votedMap[p._id] = v;
          const o = getOwnerKey(p._id);
          if (o) ownerMap[p._id] = o;
        });
        setVoted(votedMap);
        setOwnerKeys(ownerMap);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Live countdown while there are open polls.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Deep link: /polls?poll=<id> scrolls to + highlights that poll.
  const pollParam = searchParams.get('poll');
  useEffect(() => {
    if (!pollParam || loading) return;
    const el = document.getElementById(`poll-${pollParam}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightId(pollParam);
      const t = setTimeout(() => setHighlightId(null), 2500);
      return () => clearTimeout(t);
    }
  }, [pollParam, loading]);

  const activePolls = useMemo(() => polls.filter((p) => !p.closed), [polls]);
  const closedPolls = useMemo(() => polls.filter((p) => p.closed), [polls]);

  const handleVote = async (poll, optionIndex) => {
    if (voted[poll._id] != null) return;
    setBusyPollId(poll._id);
    try {
      const updated = await votePoll(poll._id, optionIndex, voterId);
      setPolls((prev) => prev.map((p) => (p._id === updated._id ? updated : p)));
      setVotedOption(poll._id, optionIndex);
      setVoted((prev) => ({ ...prev, [poll._id]: optionIndex }));
      toast.success('Vote recorded!');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyPollId(null);
    }
  };

  const handleCreate = async ({ question, options, durationMinutes, creator }) => {
    setSubmitting(true);
    try {
      const poll = await createPoll({ question, options, durationMinutes, creator });
      const { ownerKey, ...publicPoll } = poll;
      setOwnerKey(poll._id, ownerKey);
      setOwnerKeys((prev) => ({ ...prev, [poll._id]: ownerKey }));
      setPolls((prev) => [publicPoll, ...prev]);
      setShowForm(false);
      toast.success('Poll created!');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = async (poll) => {
    try {
      const updated = await closePoll(poll._id, ownerKeys[poll._id]);
      setPolls((prev) => prev.map((p) => (p._id === updated._id ? updated : p)));
      toast.info('Poll closed');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const handleDelete = async (poll) => {
    try {
      await deletePoll(poll._id, ownerKeys[poll._id]);
      removeOwnerKey(poll._id);
      setOwnerKeys((prev) => {
        const next = { ...prev };
        delete next[poll._id];
        return next;
      });
      setPolls((prev) => prev.filter((p) => p._id !== poll._id));
      toast.info('Poll deleted');
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <>
      <SEO
        title="Polls"
        description="Create and vote in quick polls. No sign-in required — make a poll and share the link with your friends."
        path="/polls"
      />
      <div className="polls-page">
        <div className="polls-ambient" aria-hidden="true">
          <span className="polls-orb polls-orb--1" />
          <span className="polls-orb polls-orb--2" />
          <span className="polls-orb polls-orb--3" />
        </div>
        <Header />
        <main className="polls-container">
          <header className="polls-hero">
            <p className="polls-eyebrow">Interactive · No sign-in required</p>
            <h1 className="polls-title">Polls</h1>
            <p className="polls-subtitle">
              Make a poll and share the link with your friends. Vote, watch results update live, and keep the conversation going.
            </p>
            <div className="polls-hero__actions">
              <button
                type="button"
                className="polls-toggle"
                onClick={() => setShowForm((v) => !v)}
              >
                {showForm ? 'Hide creator' : '+ Create a poll'}
              </button>
            </div>
            {!loading && !error && polls.length > 0 && (
              <div className="polls-stats" aria-label="Poll statistics">
                <span className="polls-stats__item"><strong>{activePolls.length}</strong> active</span>
                <span className="polls-stats__item"><strong>{closedPolls.length}</strong> closed</span>
                <span className="polls-stats__item"><strong>{polls.reduce((n, p) => n + (p.totalVotes || 0), 0)}</strong> votes</span>
              </div>
            )}
          </header>

          {showForm && (
            <CreatePollForm onSubmit={handleCreate} submitting={submitting} />
          )}

          {loading && (
            <div className="polls-state">
              <div className="route-spinner__dot" />
              <span>Loading polls…</span>
            </div>
          )}

          {!loading && error && (
            <div className="polls-state polls-state--error">
              <span>⚠️ {error}</span>
              <button type="button" className="polls-retry" onClick={() => window.location.reload()}>
                Retry
              </button>
            </div>
          )}

          {!loading && !error && polls.length === 0 && (
            <div className="polls-state">
              <span>📊 No polls yet — be the first to create one!</span>
            </div>
          )}

          {!loading && !error && activePolls.length > 0 && (
            <section className="polls-section">
              <h2 className="polls-section__title">
                Active polls
                <span className="polls-section__count">{activePolls.length}</span>
              </h2>
              <div className="polls-grid">
                {activePolls.map((poll) => (
                  <PollCard
                    key={poll._id}
                    poll={poll}
                    votedOption={voted[poll._id] ?? null}
                    ownerKey={ownerKeys[poll._id] || null}
                    busy={busyPollId === poll._id}
                    highlight={highlightId === poll._id}
                    now={now}
                    onVote={handleVote}
                    onClose={handleClose}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </section>
          )}

          {!loading && !error && closedPolls.length > 0 && (
            <section className="polls-section">
              <h2 className="polls-section__title">
                Closed polls
                <span className="polls-section__count">{closedPolls.length}</span>
              </h2>
              <div className="polls-grid">
                {closedPolls.map((poll) => (
                  <PollCard
                    key={poll._id}
                    poll={poll}
                    votedOption={voted[poll._id] ?? null}
                    ownerKey={ownerKeys[poll._id] || null}
                    busy={false}
                    highlight={highlightId === poll._id}
                    now={now}
                    onVote={handleVote}
                    onClose={handleClose}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </section>
          )}
        </main>
        <Footer />
      </div>
    </>
  );
}

export default Polls;
