import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getConversationMessages,
  getMessengerPeer,
  markConversationRead,
  sendConversationMessage,
} from '../../../services/messengerApi.js';
import { TALK_LIMITS_FALLBACK, messengerErrorMessage } from '../../../utils/talkUtils.js';
import useAvatars from '../../../hooks/useAvatars.js';
import { profilePath } from '../../../utils/userProfileUtils.js';
import TalkAvatar from './TalkAvatar.jsx';
// The AI chat's frame, imported on purpose: this component wears `ChatWindow`'s
// classes so the two panes are the same UI rather than two that look alike.
import '../../SimpleAddon/ChatWindow.css';
import './DirectChat.css';

/** How often we ask for messages that arrived since the newest one we hold. */
const POLL_MS = 4000;

/**
 * The stamp under a message, in the AI chat's own format (see `MessageBubble`):
 * the time alone for today, with the day attached once it is older. That is how
 * a long conversation keeps its dates without a divider band the AI's
 * transcript does not have.
 */
function stampOf(sentAt) {
  const when = new Date(sentAt);
  const time = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  if (when.toDateString() === today.toDateString()) return time;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (when.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${when.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

/**
 * DirectChat — a person-to-person conversation, rendered INSIDE the chat
 * (`SimpleChat`) at `/net?with=<userId>`, in the pane beside the same rail.
 *
 * It is not a second app on the same URL. Every class in the render below is
 * `ChatWindow`'s — header, transcript rows, bubbles, composer — and those read
 * their colours from `.simple-root` (`SimpleTheme.css`), so the person pane and
 * the AI pane are the same UI by construction rather than by imitation. What is
 * left out is the AI's tooling (attach/mic/model controls, token and cost
 * chips, the report menu): the messenger carries plain text, and a control this
 * conversation cannot honour is a lie shaped like a button.
 *
 * Talking to a person must NOT go through the model: no provider, no tokens, no
 * cost, and no message body leaves the messenger's own endpoints (where it is
 * encrypted before it is stored).
 *
 * The page shell (`100svh`, the composer above the keyboard, `overscroll-behavior`)
 * is Net's, not this component's: this fills it, scrolls the transcript inside it,
 * and keeps the composer pinned to the bottom.
 */
function DirectChat({ peerId, user, isSidebarOpen = false, onToggleSidebar }) {
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

  const overLimit = draft.length > limit;

  // The peer's face. Only reached for an accepted connection: anything else is
  // refused by the server (and by the "not connected" state below), so this
  // never shows the picture of someone you never added.
  const peerAvatars = useAvatars(useMemo(() => (peer?.isFriend ? [peer.userId] : []), [peer]), token);

  // ── The frame ───────────────────────────────────────────────────────────
  //
  // `ChatWindow`'s classes, so this pane is the AI chat's UI. The rail's toggle
  // is the same control in the same place, because on a phone the rail has to
  // behave identically in both modes.
  const shell = (children) => (
    <main className="chat-window talk-dm">
      <header className="chat-window__header">
        <button
          className="chat-window__menu-btn"
          onClick={onToggleSidebar}
          title="Conversations"
          aria-label="Toggle conversations"
          aria-expanded={!!isSidebarOpen}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <div className="chat-window__header-info">
          <TalkAvatar
            src={peerAvatars[peer?.userId]}
            name={peer?.nickname}
            className="talk-dm-avatar"
          />
          {/* ⚠️ One line, like the AI chat's title — no sub-line under it. A
              second line made this header 16px taller than the assistant's,
              which is exactly the kind of difference that makes two panes read
              as two apps. The assurance lives in the title attribute, the
              empty state, and the People row where the conversation starts. */}
          <h1 className="chat-window__title" title="Encrypted · no AI in this conversation">
            {peer?.nickname || 'Conversation'}
          </h1>
        </div>
        <div className="chat-window__header-spacer" />
        {peer?.isFriend && (
          <Link
            className="talk-dm-profile"
            to={profilePath(peer.nickname)}
            title={`Open ${peer.nickname}'s profile`}
          >
            Profile ↗
          </Link>
        )}
      </header>
      {children}
    </main>
  );

  // ── Not connected (or still loading the connection) ──
  if (loading) {
    return shell(
      <div className="chat-window__messages">
        <div className="chat-window__empty">
          <p>Opening the conversation…</p>
        </div>
      </div>,
    );
  }

  if (error && !peer) {
    return shell(
      <div className="chat-window__messages">
        <div className="chat-window__empty">
          <h2>Can&apos;t open that conversation</h2>
          <p>{error}</p>
          <Link className="chat-window__suggestion" to="/talk">Back to Talk</Link>
        </div>
      </div>,
    );
  }

  if (peer && !peer.isFriend) {
    return shell(
      <div className="chat-window__messages">
        <div className="chat-window__empty">
          <h2>{peer.nickname}</h2>
          <p>
            You are not connected with {peer.nickname} yet, so there is nothing to say here.
            Send them a request from Talk and this page becomes your conversation.
          </p>
          <Link className="chat-window__suggestion" to="/talk">↗ Go to Talk</Link>
        </div>
      </div>,
    );
  }

  return shell(
    <>
      <div className="chat-window__messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-window__empty">
            <div className="chat-window__empty-icon talk-dm-empty-avatar">
              <TalkAvatar src={peerAvatars[peer?.userId]} name={peer?.nickname} />
            </div>
            <h2>{peer?.nickname}</h2>
            <p>Send a message to start chatting — nothing said here goes to the AI assistant.</p>
          </div>
        )}

        {messages.map((message) => {
          const mine = message.from === 'me';
          return (
            /* `MessageBubble`'s own markup, minus its menu: same row, same avatar
               slot, same bubble and meta line, so the two transcripts are
               indistinguishable apart from the missing AI-only affordances. */
            <div key={message.cursor} className={`message message--${mine ? 'user' : 'assistant'}`}>
              <div className="message__row">
                {!mine && (
                  <TalkAvatar
                    src={peerAvatars[peer?.userId]}
                    name={peer?.nickname}
                    className="message__avatar message__avatar--assistant"
                  />
                )}

                <div className="message__content">
                  <div className={`message__bubble message__bubble--${mine ? 'user' : 'assistant'}`}>
                    {message.body === null ? (
                      // A row the server could not decrypt (a rotated key, a
                      // hand-edited row). Saying so beats rendering nothing.
                      <p className="message__text talk-dm-unreadable">This message could not be read.</p>
                    ) : (
                      <p className="message__text">{message.body}</p>
                    )}
                  </div>

                  <div className="message__meta">
                    <span className="message__time">{stampOf(message.sentAt)}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <form className="chat-window__input-form" onSubmit={handleSend}>
        <div className="chat-window__input-wrapper">
          <label className="sr-only" htmlFor="talk-dm-input">Message</label>
          <textarea
            id="talk-dm-input"
            className="chat-window__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter is a new line — the convention every
              // chat app has taught people.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder={`Message ${peer?.nickname || ''}…`}
            rows={1}
            maxLength={limit}
            disabled={sending}
          />
          <button
            type="submit"
            className="chat-window__send-btn"
            disabled={sending || !draft.trim() || overLimit}
            title="Send message"
          >
            <span className="chat-window__btn-icon" aria-hidden="true">➤</span>
            <span className="chat-window__btn-label">Send</span>
          </button>
        </div>
        {/* The AI chat's hint line, in the same place — an error takes it over
            rather than adding a band of its own. */}
        {error ? (
          <div className="chat-window__input-hint talk-dm-error" role="alert">{error}</div>
        ) : (
          <div className="chat-window__input-hint">
            Press Enter to send, Shift+Enter for new line
          </div>
        )}
      </form>
    </>,
  );
}

export default DirectChat;
