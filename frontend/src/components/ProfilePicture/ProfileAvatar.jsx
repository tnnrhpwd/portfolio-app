import BrandMark from '../BrandMark/BrandMark.jsx';
import './ProfileAvatar.css';

/**
 * ProfileAvatar — renders the user's uploaded picture, falling back to the
 * brand checkmark so every account has a face from day one.
 *
 * ⚠️ THE FALLBACK IS THE `plate` VARIANT — THE STATIC COLOURWAY — AND THAT IS A
 * DECISION, NOT AN OVERSIGHT. Everywhere else the mark follows the visitor's colour
 * scheme; here it must not. This mark stands in for a PERSON, so a scheme-aware one
 * would give a user a different-coloured face on their phone than on their laptop,
 * and the thing a user is looking at is meant to be their own identity. The `plate`
 * variant exists to say that in code rather than in a comment nobody reads.
 * See docs/guides/LOGO_SYSTEM.md §5.
 *
 * The saved `profilePicture` is already a square, cropped data URL (see
 * ProfilePictureEditor), so this component never does any crop math — it just
 * fills and rounds the frame.
 *
 * @param {Object}  props
 * @param {string}  [props.picture]  Data URL of the profile picture.
 * @param {string}  [props.name]     Display name, used for the alt text.
 * @param {'sm'|'md'|'lg'} [props.size]  Preset size.
 * @param {string}  [props.className]    Extra classes for the caller.
 */
function ProfileAvatar({ picture, name = '', size = 'md', className = '' }) {
  const hasPicture = Boolean(picture);
  const classes = ['profile-avatar', `profile-avatar--${size}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes}>
      {hasPicture ? (
        <img
          className="profile-avatar__img"
          src={picture}
          alt={name ? `${name}'s profile picture` : ''}
          draggable={false}
        />
      ) : (
        // Decorative: the name is always adjacent in the UI.
        <BrandMark className="profile-avatar__mark" size="100%" variant="plate" />
      )}
    </span>
  );
}

export default ProfileAvatar;
