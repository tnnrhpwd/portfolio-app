import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getConversationMessages,
  getMessengerPeer,
  markConversationRead,
  sendConversationMessage,
} from '../../../services/messengerApi.js';
import { TALK_LIMITS_FALLBACK, clockTime, groupByDay, messengerErrorMessage } from '../../../utils/talkUtils.js';
import useAvatars from '../../../hooks/useAvatars.js';
import { profilePath } from '../../../utils/userProfileUtils.js';
import TalkAvatar from './TalkAvatar.jsx';
import './DirectChat.css';

/** How often we ask for messages that arrived since the newest one we hold. */
const POLL_MS = 4000;

/**
 * DirectChat — a person-to-person conversation, rendered by /net in place of the
 * AI chat (`/net?with=<userId>`).
 *
 * Why it replaces the chat rather than sitting beside it: the whole point of the
 * request was that talking to a person must NOT go through the model. A member
 * conversation shares the page shell, but nothing about it touches the LLM — no
 * provider, no tokens, no cost, and no message body leaves the messenger's own
 * endpoints (where it is encrypted before it is stored).
 *
 * The page shell (`100svh`, the composer above the keyboard, `overscroll-behavior`)
 * is Net's, not this component's: this fills it, scrolls the transcript inside it,
 * and keeps the composer pinned to the bottom.
 */
function DirectChat({ peerId, user }) {
  const token = user?.token;

  const [peer, setPeer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const scrollRef = useRef(null);
  /** The newest message's sort key — the `since` cursor for the next poll. */
  const cursorRef = useRef('');
  /** A send in flight must not be raced by the poll's response. */
  const sendingRef = useRef(false);

  const limit = TALK_LIMITS_FALLBACK.bodyMax;

  // ── Load: who is this, are we connected, and what has been said ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    (async () => {
      try {
        const info = await getMessengerPeer(token, peerId);
        if (cancelled) return;
        setPeer(info.peer);

        if (!info.peer.isFriend) {
          if (!cancelled) setLoading(false);
          return;
        }

        const data = await getConversationMessages(token, peerId);
        if (cancelled) return;
        setMessages(data.messages);
        cursorRef.current = data.messages[data.messages.length - 1]?.cursor || '';
        setLoading(false);
        // Opening a conversation is reading it.
        markConversationRead(token, peerId).catch(() => {});
      } catch (err) {
        if (cancelled) return;
        setError(messengerErrorMessage(err, 'Could not open that conversation.'));
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [peerId, token]);

  // ── Poll for anything new while the conversation is open ──
  useEffect(() => {
    if (!peer?.isFriend) return undefined;

    let cancelled = false;
    const tick = async () => {
      // A hidden tab is not reading: skip the request rather than burn a poll
      // every 4s in a background tab.
      if (document.hidden || sendingRef.current) return;
      try {
        const data = await getConversationMessages(token, peerId, {
          since: cursorRef.current || undefined,
        });
        if (cancelled || data.messages.length === 0) return;
        setMessages((prev) => [...prev, ...data.messages]);
        cursorRef.current = data.messages[data.messages.length - 1].cursor;
        markConversationRead(token, peerId).catch(() => {});
      } catch {
        // A failed poll is not worth interrupting the conversation for; the next
        // tick retries. A hard failure still shows up when the user sends.
      }
    };

    const id = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [peer, peerId, token]);

  // ── Keep the newest message in view ──
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  const handleSend = useCallback(async (event) => {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    sendingRef.current = true;
    setDraft('');
    setError('');
    try {
      const result = await sendConversationMessage(token, peerId, body);
      setMessages((prev) => [...prev, result.message]);
      cursorRef.current = result.message.cursor;
    } catch (err) {
      // Put the text back rather than losing what they typed.
      setDraft(body);
      setError(messengerErrorMessage(err, 'Message not sent. Please try again.'));
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }, [draft, peerId, sending, token]);

  const days = useMemo(() => groupByDay(messages), [messages]);
  const overLimit = draft.length > limit;

  // The peer's face. Only reached for an accepted connection: anything else is
  // refused by the server (and by the "not connected" state below), so this
  // never shows the picture of someone you never added.
  const peerAvatars = useAvatars(useMemo(() => (peer?.isFriend ? [peer.userId] : []), [peer]), token);

  // ── Not connected (or still loading the connection) ──
  if (loading) {
    return (
      <div className="talk-dm talk-dm--canned">
        <p className="talk-dm-canned-text">Opening the conversation…</p>
      </div>
    );
  }

  if (error && !peer) {
    return (
      <div className="talk-dm talk-dm--canned">
        <p className="talk-dm-canned-text">{error}</p>
        <Link className="talk-dm-canned-link" to="/talk">Back to Talk</Link>
      </div>
    );
  }

  if (peer && !peer.isFriend) {
    return (
      <div className="talk-dm talk-dm--canned">
        <h2 className="talk-dm-canned-title">{peer.nickname}</h2>
        <p className="talk-dm-canned-text">
          You are not connected with {peer.nickname} yet, so there is nothing to say here.
          Send them a request from Talk and this page becomes your conversation.
        </p>
        <Link className="talk-dm-canned-link" to="/talk">↗ Go to Talk</Link>
      </div>
    );
  }

  return (
    <div className="talk-dm">
      {/* A member conversation is a different mode of this page, so the way out
          of it is stated rather than implied. */}
      <header className="talk-dm-bar">
        <Link className="talk-dm-back" to="/net">← AI chat</Link>
        {/* Their public page is one click from the conversation header. */}
        <Link
          className="talk-dm-person"
          to={profilePath(peer?.nickname)}
          title={`Open ${peer?.nickname || 'their'}'s profile`}
        >
          <TalkAvatar src={peerAvatars[peer?.userId]} name={peer?.nickname} className="talk-dm-avatar" />
          <span className="talk-dm-who">
            <strong className="talk-dm-name">{peer?.nickname}</strong>
            <span className="talk-dm-sub">Encrypted · no AI in this conversation</span>
          </span>
        </Link>
      </header>

      <div className="talk-dm-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <p className="talk-dm-empty">
            No messages yet. This conversation is just the two of you — nothing said here goes to the
            AI assistant.
          </p>
        )}

        {days.map((day) => (
          <React.Fragment key={day.label}>
            <div className="talk-dm-day"><span>{day.label}</span></div>
            {day.messages.map((message) => (
              <div key={message.cursor} className={`talk-dm-msg talk-dm-msg--${message.from}`}>
                <div className="talk-dm-bubble">
                  {message.body === null ? (
                    // A row the server could not decrypt (a rotated key, a
                    // hand-edited row). Saying so beats rendering nothing.
                    <em className="talk-dm-unreadable">This message could not be read.</em>
                  ) : (
                    message.body
                  )}
                </div>
                <span className="talk-dm-time">{clockTime(message.sentAt)}</span>
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>

      {error && <p className="talk-dm-error" role="alert">{error}</p>}

      <form className="talk-dm-composer" onSubmit={handleSend}>
        <label className="sr-only" htmlFor="talk-dm-input">Message</label>
        <textarea
          id="talk-dm-input"
          className="talk-dm-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a new line — the convention every chat
            // app has taught people.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={`Message ${peer?.nickname || ''}…`}
          rows={1}
          maxLength={limit}
        />
        <button
          type="submit"
          className="talk-dm-send"
          disabled={sending || !draft.trim() || overLimit}
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

export default DirectChat;
