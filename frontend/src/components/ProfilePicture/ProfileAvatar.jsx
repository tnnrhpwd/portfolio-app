import HeaderLogo from '../../assets/Checkmark512.png';
import './ProfileAvatar.css';

/**
 * ProfileAvatar — renders the user's uploaded picture, falling back to the
 * brand checkmark so every account has a face from day one.
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
      <img
        className="profile-avatar__img"
        src={hasPicture ? picture : HeaderLogo}
        alt={hasPicture && name ? `${name}'s profile picture` : ''}
        draggable={false}
      />
    </span>
  );
}

export default ProfileAvatar;
