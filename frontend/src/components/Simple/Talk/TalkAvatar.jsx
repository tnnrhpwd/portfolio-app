import { initials } from '../../../utils/talkUtils.js';

/**
 * TalkAvatar — a person's face in Talk, falling back to their initials.
 *
 * ⚠️ The fallback is INITIALS, not the brand mark that `ProfileAvatar` draws for
 * an account with no picture. That is the difference between the two places they
 * appear: `/profile` shows one person you already know, so a consistent mark is
 * fine; a contact list shows a column of them, where ten identical checkmarks
 * identify nobody, and "GU" vs "GW" does.
 *
 * The picture itself is the 96px JPEG the server builds (see
 * `backend/services/avatarService.js`) — never the stored 512px original, which
 * would be ~20x the pixels this frame can show.
 *
 * @param {object} props
 * @param {string|null} [props.src] - Data URL, or nothing for initials.
 * @param {string} [props.name] - Display name, used for the initials and the alt text.
 * @param {string} [props.className] - The frame's class (the caller owns the size).
 */
function TalkAvatar({ src, name = '', className = 'talk-avatar' }) {
  return (
    <span className={className}>
      {src ? (
        <img
          className="talk-avatar__img"
          src={src}
          alt={name ? `${name}'s profile picture` : ''}
          draggable={false}
          loading="lazy"
        />
      ) : (
        // Decorative: the name is always beside the frame in both places this is used.
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  );
}

export default TalkAvatar;
