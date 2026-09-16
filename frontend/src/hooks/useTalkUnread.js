import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { getMessengerDirectory } from '../services/messengerApi.js';
import {
  publishTalkUnread,
  readTalkUnread,
  subscribeTalkUnread,
  sumUnread,
  talkUnreadAge,
} from '../utils/talkUnread.js';

/** How often the chrome asks, when nothing else on the page already has. */
const POLL_MS = 60000;

/** A value this young is not asked for again — the /net rail polls every 30s. */
const FRESH_MS = 15000;

/** One interval for the whole page — see rule 1 below. */
let poller = null;

/** In-flight requests, so a remount (StrictMode) cannot double-ask. */
let inflight = null;

/** Live hook instances, so the poll stops when the last one unmounts. */
let mounted = 0;

/** Fetch the dashboard and publish its total. Never rejects. */
function fetchUnread(token) {
  if (inflight?.token === token) return inflight.promise;

  const promise = (async () => {
    try {
      const directory = await getMessengerDirectory(token);
      publishTalkUnread(token, sumUnread(directory?.contacts));
    } catch {
      // Cosmetic — see rule 3 in the hook's doc. The badge keeps its last value.
    } finally {
      if (inflight?.token === token) inflight = null;
    }
  })();

  inflight = { token, promise };
  return promise;
}

/** Ask, unless the value is already fresh (rule 2). */
function refresh(token) {
  if (!token || talkUnreadAge(token) < FRESH_MS) return;
  fetchUnread(token);
}

function stopPolling() {
  if (!poller) return;
  clearInterval(poller.id);
  window.removeEventListener('focus', poller.onWake);
  document.removeEventListener('visibilitychange', poller.onWake);
  poller = null;
}

function startPolling(token) {
  stopPolling();

  // Coming back to the tab is the moment a stale badge is most obvious, and the
  // listener is one comparison for a signed-in page that never leaves the
  // foreground (the freshness check does the rest).
  const onWake = () => {
    if (document.visibilityState !== 'hidden') refresh(token);
  };

  poller = { token, id: setInterval(() => refresh(token), POLL_MS), onWake };
  window.addEventListener('focus', onWake);
  document.addEventListener('visibilitychange', onWake);
}

/**
 * useTalkUnread — the signed-in account's unread message count, for the chrome
 * that links into Talk (`TalkUnreadBadge`).
 *
 * Three rules make this cheap enough to live in the site header:
 *
 * 1. **One poll per page.** The interval is owned by the module, not by the
 *    component, so the N badges on a page (four links on a member page, say)
 *    still ask the server once. The first subscriber starts the poll and the last
 *    one to leave stops it.
 * 2. **Nobody fetches what someone just fetched.** A value younger than
 *    `FRESH_MS` is not asked for again, and the /net rail and `/talk` publish
 *    their own dashboard every 30s — so on those surfaces this hook usually makes
 *    no request at all (`publishTalkUnread`).
 * 3. **Silence on failure.** An unread badge is decoration: a failed request
 *    leaves the last known number up and the next tick retries. It never throws,
 *    never toasts, and never blanks the link it sits on.
 *
 * The count is unread MESSAGES only. A pending friend request is not a message,
 * and inventing a combined number here would make every badge mean two things.
 *
 * @returns {number} Unread messages for the signed-in account (0 when signed out).
 */
export default function useTalkUnread() {
  const token = useSelector((state) => state.data.user?.token) || '';
  const [unread, setUnread] = useState(() => readTalkUnread(token));

  useEffect(() => {
    if (!token) {
      // Signed out: no messages, and nothing left over from the last account.
      setUnread(0);
      return undefined;
    }

    setUnread(readTalkUnread(token));
    const unsubscribe = subscribeTalkUnread((next) => {
      setUnread(next.token === token ? next.unread : 0);
    });

    refresh(token);
    mounted += 1;
    if (!poller || poller.token !== token) startPolling(token);

    return () => {
      unsubscribe();
      mounted -= 1;
      if (mounted <= 0) stopPolling();
    };
  }, [token]);

  return unread;
}
