import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';
import SEO from '../../../components/SEO/SEO.jsx';
import LoginGate from '../../../components/Simple/LoginGate/LoginGate.jsx';
import Spinner from '../../../components/Spinner/Spinner.jsx';
import TalkAvatar from '../../../components/Simple/Talk/TalkAvatar.jsx';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getMessengerDirectory,
  removeMessengerContact,
  sendFriendRequest,
} from '../../../services/messengerApi.js';
import {
  TALK_LIMITS_FALLBACK,
  messengerErrorMessage,
  relativeTime,
  requestBudgetHint,
} from '../../../utils/talkUtils.js';
import { profilePath } from '../../../utils/userProfileUtils.js';
import useAvatars from '../../../hooks/useAvatars.js';
import './Talk.css';

/**
 * Talk — the messenger's front door (docs/implementation/agent.md §18).
 *
 * A SERVICE PAGE (FRONTEND_UI_STANDARD.md §5.7): the shared ambient room for a
 * ground, one sticky toolbar carrying the name + live state, then a dense grid of
 * panels. No bands, no decorative circles, no scroll reveals — the only motion
 * here is "state changed" (a request arriving, a connection appearing).
 *
 * Deliberately NOT a directory of users. You cannot browse the app's accounts
 * from here: you type a username you already know and ask to connect, which is
 * what makes the request limits meaningful rather than theatre. The actual
 * conversation happens on /net (`?with=<userId>`), which switches that page from
 * the AI chat to a direct conversation.
 */
function Talk() {
  const { user } = useSelector((state) => state.data);
  const token = user?.token;

  const [directory, setDirectory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [username, setUsername] = useState('');
  const [sending, setSending] = useState(false);
  /** The id of the row with an action in flight, so one row can be busy alone. */
  const [busyId, setBusyId] = useState(null);

  const limits = directory?.limits || TALK_LIMITS_FALLBACK;

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!token) {
      setDirectory(null);
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const data = await getMessengerDirectory(token);
      setDirectory(data);
      setError('');
    } catch (err) {
      setError(messengerErrorMessage(err, 'Could not load Talk.'));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  /** Every action returns the refreshed dashboard, so one call updates the page. */
  const applyResult = useCallback((result) => {
    if (result && Array.isArray(result.contacts)) setDirectory(result);
  }, []);

  const handleSendRequest = useCallback(async (event) => {
    event.preventDefault();
    const name = username.trim();
    if (!name) return;

    setSending(true);
    setNotice(null);
    try {
      const result = await sendFriendRequest(token, name);
      applyResult(result);
      setUsername('');
      setNotice({
        tone: 'ok',
        text: result.autoAccepted
          ? `${result.nickname} had already asked to connect — you are connected now.`
          : `Request sent to ${result.nickname}. They will see it when they open Talk.`,
      });
    } catch (err) {
      setNotice({ tone: 'error', text: messengerErrorMessage(err, 'Could not send that request.') });
    } finally {
      setSending(false);
    }
  }, [applyResult, token, username]);

  const runRowAction = useCallback(async (id, action) => {
    setBusyId(id);
    setNotice(null);
    try {
      applyResult(await action());
    } catch (err) {
      setNotice({ tone: 'error', text: messengerErrorMessage(err, 'That did not work. Please try again.') });
    } finally {
      setBusyId(null);
    }
  }, [applyResult]);

  const handleRemove = useCallback((contact) => {
    if (!window.confirm(`Remove ${contact.nickname} from your connections? Your messages are kept.`)) return;
    runRowAction(contact.userId, () => removeMessengerContact(token, contact.userId));
  }, [runRowAction, token]);

  const pendingIn = directory?.pendingIn || [];
  const pendingOut = directory?.pendingOut || [];
  const contacts = directory?.contacts || [];
  const unreadTotal = useMemo(
    () => contacts.reduce((sum, c) => sum + (Number(c.unread) || 0), 0),
    [contacts]
  );

  // Only for CONNECTIONS. A pending request is not a connection yet, so the
  // server would skip it anyway (that gate is what makes "you only see the face
  // of someone you are connected to" a rule) — asking would be a wasted request
  // per row, so the ids are drawn from `contacts` alone.
  const avatars = useAvatars(
    useMemo(() => contacts.map((c) => c.userId), [contacts]),
    token
  );

  const statusLine = !user
    ? 'Sign in to connect'
    : directory
      ? `@${directory.me.nickname} · ${contacts.length} connection${contacts.length === 1 ? '' : 's'}`
      // ⚠️ Only claim to be connecting while we actually are. A failed load used
      // to sit on "Connecting…" forever, which reads as a hang rather than as an
      // error — and the page underneath it showed empty panels, as if the account
      // genuinely had no contacts.
      : error
        ? 'Unavailable'
        : 'Connecting…';

  return (
    <>
      <SEO
        title="Talk"
        description="Message other STHopwood members directly. Send a friend request, then talk privately."
        path="/talk"
      />
      <Header />

      <div className="talk service-room">
        <div className="talk-shell">
          {/* ── Toolbar: the page's hero, collapsed onto one sticky row ── */}
          <header className="talk-bar">
            <h1 className="talk-bar-title">Talk</h1>
            <span className="talk-bar-status">{statusLine}</span>

            {directory && (
              <ul className="talk-bar-readout">
                <li className="talk-chip">
                  Requests <strong>{pendingIn.length}</strong>
                </li>
                <li className="talk-chip">
                  Waiting <strong>{pendingOut.length}</strong>
                </li>
                <li className={`talk-chip ${unreadTotal > 0 ? 'talk-chip--accent' : ''}`}>
                  Unread <strong>{unreadTotal}</strong>
                </li>
              </ul>
            )}

            <div className="talk-bar-actions">
              <button
                type="button"
                className="talk-btn talk-btn--ghost"
                onClick={() => load()}
                disabled={!user || loading}
                title="Check for new requests"
              >
                ↻ Refresh
              </button>
            </div>
          </header>

          {!user ? (
            <LoginGate
              redirectTo="/talk"
              eyebrow="Talk"
              title="Sign in to Talk"
              subtitle="Connect with other members and message them directly."
            />
          ) : loading && !directory ? (
            <div className="talk-loading"><Spinner /></div>
          ) : !directory ? (
            /* Nothing loaded, so there is nothing true to show. Say that, and put
               the way out in the same place — the alternative (an alert over
               empty panels) claims the account has no requests and no contacts. */
            <section className="talk-panel talk-panel--failed" aria-labelledby="talk-failed-title">
              <h2 className="talk-panel-title" id="talk-failed-title">Can&apos;t load Talk</h2>
              <p className="talk-empty">
                {error || 'The messenger did not answer.'}
              </p>
              <div className="talk-row-actions">
                <button
                  type="button"
                  className="talk-btn talk-btn--primary"
                  onClick={() => load()}
                  disabled={loading}
                >
                  {loading ? 'Retrying…' : '↻ Try again'}
                </button>
              </div>
            </section>
          ) : (
            <>
              {error && <p className="talk-alert talk-alert--error" role="alert">{error}</p>}
              {notice && (
                <p
                  className={`talk-alert ${notice.tone === 'ok' ? 'talk-alert--ok' : 'talk-alert--error'}`}
                  role="status"
                >
                  {notice.text}
                </p>
              )}

              {/* ── Add a friend — the primary tool, so it leads the grid ── */}
              <section className="talk-panel talk-panel--add" aria-labelledby="talk-add-title">
                <h2 className="talk-panel-title" id="talk-add-title">Connect with someone</h2>
                <form className="talk-add" onSubmit={handleSendRequest}>
                  <label className="sr-only" htmlFor="talk-username">Username</label>
                  <input
                    id="talk-username"
                    className="talk-input"
                    type="text"
                    name="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Their username, e.g. Guest User"
                    autoComplete="off"
                    maxLength={40}
                  />
                  <button
                    type="submit"
                    className="talk-btn talk-btn--primary"
                    disabled={sending || !username.trim()}
                  >
                    {sending ? 'Sending…' : '+ Send request'}
                  </button>
                </form>
                <p className="talk-hint">
                  {directory
                    ? requestBudgetHint(directory.remaining, limits)
                    : 'You can only connect by username — there is no member directory to browse.'}
                </p>
              </section>

              <section className="talk-panel" aria-labelledby="talk-requests-title">
                <h2 className="talk-panel-title" id="talk-requests-title">
                  Requests
                  {pendingIn.length > 0 && <span className="talk-count">{pendingIn.length}</span>}
                </h2>

                {pendingIn.length === 0 && pendingOut.length === 0 && (
                  <p className="talk-empty">No requests waiting. Send one above to get started.</p>
                )}

                {pendingIn.map((request) => (
                  <div className="talk-row" key={`in-${request.userId}`}>
                    {/* No picture here: a requester is not a connection yet. */}
                    <TalkAvatar name={request.nickname} />
                    <div className="talk-row-main">
                      <strong className="talk-row-name">{request.nickname}</strong>
                      <span className="talk-row-meta">wants to connect · {relativeTime(request.at)}</span>
                    </div>
                    <div className="talk-row-actions">
                      <button
                        type="button"
                        className="talk-btn talk-btn--primary talk-btn--sm"
                        onClick={() => runRowAction(request.userId, () => acceptFriendRequest(token, request.userId))}
                        disabled={busyId === request.userId}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="talk-btn talk-btn--ghost talk-btn--sm"
                        onClick={() => runRowAction(request.userId, () => declineFriendRequest(token, request.userId))}
                        disabled={busyId === request.userId}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}

                {pendingOut.map((request) => (
                  <div className="talk-row talk-row--muted" key={`out-${request.userId}`}>
                    <TalkAvatar name={request.nickname} />
                    <div className="talk-row-main">
                      <strong className="talk-row-name">{request.nickname}</strong>
                      <span className="talk-row-meta">waiting for an answer · {relativeTime(request.at)}</span>
                    </div>
                    <div className="talk-row-actions">
                      <button
                        type="button"
                        className="talk-btn talk-btn--ghost talk-btn--sm"
                        onClick={() => runRowAction(request.userId, () => cancelFriendRequest(token, request.userId))}
                        disabled={busyId === request.userId}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ))}
              </section>

              <section className="talk-panel talk-panel--contacts" aria-labelledby="talk-contacts-title">
                <h2 className="talk-panel-title" id="talk-contacts-title">
                  Connections
                  {contacts.length > 0 && <span className="talk-count">{contacts.length}</span>}
                </h2>

                {contacts.length === 0 && (
                  <p className="talk-empty">
                    Nothing here yet. Once someone accepts your request, they show up here with a
                    Message button.
                  </p>
                )}

                {contacts.map((contact) => (
                  <div className="talk-row" key={contact.userId}>
                    {/* The face and the name are one link to their public page —
                        clicking a person is the obvious thing to try, and it now
                        goes somewhere. */}
                    <Link
                      className="talk-row-person"
                      to={profilePath(contact.nickname)}
                      title={`Open ${contact.nickname}'s profile`}
                    >
                      <TalkAvatar
                        src={avatars[contact.userId]}
                        name={contact.nickname}
                        className="talk-avatar"
                      />
                      <span className="talk-row-main">
                        <strong className="talk-row-name">
                          {contact.nickname}
                          {contact.unread > 0 && (
                            <span className="talk-unread" aria-label={`${contact.unread} unread`}>
                              {contact.unread}
                            </span>
                          )}
                        </strong>
                        <span className="talk-row-meta">
                          {contact.lastPreview
                            ? `${contact.lastPreview} · ${relativeTime(contact.lastAt)}`
                            : 'No messages yet'}
                        </span>
                      </span>
                    </Link>
                    <div className="talk-row-actions">
                      {/* A new tab, not a navigation away: Talk stays open behind it. */}
                      <Link
                        className="talk-btn talk-btn--primary talk-btn--sm"
                        to={`/net?with=${encodeURIComponent(contact.userId)}`}
                      >
                        Message
                      </Link>
                      <button
                        type="button"
                        className="talk-btn talk-btn--ghost talk-btn--sm"
                        onClick={() => handleRemove(contact)}
                        disabled={busyId === contact.userId}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </section>

              <details className="talk-panel talk-panel--info">
                <summary className="talk-panel-title">How Talk works</summary>
                <ul className="talk-facts">
                  <li>
                    <strong>Connect by username.</strong> There is no member list to browse — you
                    enter a username someone has given you and ask to connect.
                  </li>
                  <li>
                    <strong>Requests are limited.</strong> Up to {limits.pendingOutMax} requests can be
                    waiting at once, {limits.requestsPerHour} per hour and {limits.requestsPerDay} per
                    day. A declined request cannot be retried for a week.
                  </li>
                  <li>
                    <strong>Messages are encrypted in transit and at rest.</strong> The conversation
                    itself happens on the Chat page, where an open conversation with a member replaces
                    the AI assistant for that view — messages between people are never sent to a model.
                  </li>
                </ul>
              </details>
            </>
          )}
        </div>
      </div>

      <Footer />
    </>
  );
}

export default Talk;
