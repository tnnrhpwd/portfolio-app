import './TalkUnreadBadge.css';

/**
 * TalkUnreadBadge — the unread message count, as the circle that sits beside
 * every link into Talk.
 *
 * A DUMB component on purpose: it is handed a number. The callers differ in
 * where their number comes from — the site chrome asks `useTalkUnread`, while
 * the /net rail and `/talk` already hold a dashboard in state — and a component
 * that fetched its own would make those two re-ask for what they have.
 *
 * Renders NOTHING at zero. A badge that says "0" is a badge that has to be read
 * to be dismissed; the absence of one is the readable form of "nothing waiting".
 *
 * @param {object} props
 * @param {number} [props.count] - Unread messages; 0, null and undefined all mean "no badge".
 * @param {string} [props.className] - Extra class for the frame the caller owns.
 */
function TalkUnreadBadge({ count = 0, className = '' }) {
  const unread = Number(count) || 0;
  if (unread <= 0) return null;

  const label = unread === 1 ? '1 unread message' : `${unread} unread messages`;

  return (
    <span className={`talk-badge${className ? ` ${className}` : ''}`} aria-label={label} title={label}>
      {/* Past three digits the exact number stops being a count and starts being
          a layout problem, in a badge that rides beside a link's label. */}
      {unread > 99 ? '99+' : unread}
    </span>
  );
}

export default TalkUnreadBadge;
