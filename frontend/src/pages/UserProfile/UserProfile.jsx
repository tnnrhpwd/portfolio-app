import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import SEO from '../../components/SEO/SEO.jsx';
import Spinner from '../../components/Spinner/Spinner.jsx';
import ProfileAvatar from '../../components/ProfilePicture/ProfileAvatar.jsx';
import useScrollReveal from '../../hooks/useScrollReveal.js';
import { getPublicProfile } from '../../services/publicProfileApi.js';
import { sendFriendRequest } from '../../services/messengerApi.js';
import { messengerErrorMessage } from '../../utils/talkUtils.js';
import {
  boardSummary,
  formatNumber,
  isPublicVisibility,
  memberSinceLabel,
  playLabel,
  profileStats,
  publishedKindLabel,
  ratingLabel,
  shortDate,
  visibilityLabel,
  visibilitySummary,
} from '../../utils/userProfileUtils.js';
import './UserProfile.css';

/**
 * UserProfile — the public page for one account, at `/u/<username>`.
 *
 * A DISCOVERY PAGE (FRONTEND_UI_STANDARD.md §5), because that is what it is: a
 * stranger can arrive here from a shared link knowing nothing, so it leads with a
 * face and a name, then earns the scroll with what the person has done, and ends
 * on a band that invites the visitor to have one of their own. `Talk` is the
 * service page; this is the page you send someone.
 *
 * Where the numbers come from, and how much they can be trusted, differs — so the
 * page is explicit about it rather than presenting everything as an achievement
 * record:
 *
 *   - identity, join date        → the account row
 *   - games                      → the PUBLIC game leaderboards. Those rows are
 *                                  self-reported by whoever posted them, and the
 *                                  section says so (see services/gameBoards.js).
 *   - published skills/goals      → `authorUserId` is stamped by the server on
 *                                  publish, so this is genuinely attributable.
 *
 * One `<h1>` (the name), one `<h2>` per band, and a band that has nothing in it is
 * not rendered at all — an empty "Games 0" band is worse than no band.
 */

/** The bands fade + rise once, like every other Discovery page (§5). */
function RevealBand({ tone = 'surface', label, children }) {
  const [ref, visible] = useScrollReveal();
  return (
    <section
      ref={ref}
      aria-label={label}
      className={`up-band up-band--${tone} up-reveal ${visible ? 'is-visible' : ''}`}
    >
      <div className="up-wrap">{children}</div>
    </section>
  );
}

function UserProfile() {
  const { username = '' } = useParams();
  const { user } = useSelector((state) => state.data);
  const token = user?.token;

  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | missing | error
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectNotice, setConnectNotice] = useState(null);
  const [requestSent, setRequestSent] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const data = await getPublicProfile(username, token);
      setProfile(data);
      setStatus('ready');
    } catch (err) {
      if (err.status === 404) {
        setStatus('missing');
        return;
      }
      setError(messengerErrorMessage(err, 'Could not load that profile.'));
      setStatus('error');
    }
  }, [username, token]);

  useEffect(() => { load(); }, [load]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setConnectNotice(null);
    try {
      const result = await sendFriendRequest(token, profile.nickname);
      setRequestSent(true);

      // Whether this request was accepted on the spot (they had already asked us)
      // decides the copy, and on the private page it decides more than that: the
      // lock exists because we were not connected, so becoming connected means the
      // page we are looking at is now readable. Re-fetch instead of claiming to
      // have sent a request against a page we could already be reading.
      if (result.autoAccepted) {
        setConnectNotice({ tone: 'ok', text: `You are connected with ${profile.nickname} now.` });
        await load();
        return;
      }

      setConnectNotice({
        tone: 'ok',
        text: `Request sent to ${profile.nickname}. They will see it next time they open Talk.`,
      });
    } catch (err) {
      setConnectNotice({ tone: 'error', text: messengerErrorMessage(err, 'Could not send that request.') });
    } finally {
      setConnecting(false);
    }
  }, [profile, token, load]);

  // ── Loading / not-found / failed ────────────────────────────────────────────
  // All three keep the page shell, so a bad link looks like a page rather than
  // like something broke.
  if (status !== 'ready') {
    return (
      <>
        <SEO title="Profile" description="A member profile on STHopwood." path={`/u/${username}`} />
        <Header />
        <div className="up">
          <section className="up-hero">
            <div className="up-floating" aria-hidden="true">
              <div className="up-circle up-circle-1" />
              <div className="up-circle up-circle-2" />
              <div className="up-circle up-circle-3" />
            </div>
            <div className="up-hero-wrap">
              {status === 'loading' && <Spinner />}
              {status === 'missing' && (
                <>
                  <p className="up-eyebrow">Not found</p>
                  <h1 className="up-title">No profile at “{username}”</h1>
                  <p className="up-subtitle">
                    Nobody here goes by that name. Usernames are the same ones used on Talk.
                  </p>
                  <div className="up-actions">
                    <Link className="up-btn" to="/talk">Find someone on Talk</Link>
                    {!user && <Link className="up-btn up-btn-outline" to="/register">Create your page</Link>}
                  </div>
                </>
              )}
              {status === 'error' && (
                <>
                  <p className="up-eyebrow">Unavailable</p>
                  <h1 className="up-title">Couldn’t load that profile</h1>
                  <p className="up-subtitle">{error}</p>
                  <div className="up-actions">
                    <button type="button" className="up-btn" onClick={load}>↻ Try again</button>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
        <Footer />
      </>
    );
  }

  // ── Restricted: someone else's page, kept private ───────────────────────────
  // The server answers a gated page with 200 + `restricted: true` rather than a
  // 403 (services/publicProfile.js), so a shared private link lands on a page that
  // explains itself and offers the one action that would open it — instead of a
  // dead end that looks identical to a mistyped username. Nothing about the
  // account is rendered here because nothing about it was sent: no picture, no
  // stats, no boards, no published work.
  if (profile.restricted) {
    return (
      <>
        <SEO
          title={`${profile.nickname} — private page`}
          description={`${profile.nickname} keeps their STHopwood page private.`}
          path={`/u/${username}`}
          // Reachable only by the owner and their connections: never index it.
          noindex
        />
        <Header />

        <div className="up">
          <section className="up-hero">
            <div className="up-floating" aria-hidden="true">
              <div className="up-circle up-circle-1" />
              <div className="up-circle up-circle-2" />
              <div className="up-circle up-circle-3" />
            </div>

            <div className="up-hero-wrap">
              <p className="up-lock" aria-hidden="true">🔒</p>
              <p className="up-eyebrow">Private page</p>
              <h1 className="up-title">{profile.nickname}</h1>
              <p className="up-subtitle">
                {profile.nickname} shares this page with the people they are connected with. Their
                picture, their games and what they have published stay hidden until you are one of
                them.
              </p>

              <div className="up-actions">
                {profile.canConnect && !requestSent && (
                  <>
                    <button
                      type="button"
                      className="up-btn"
                      onClick={handleConnect}
                      disabled={connecting}
                    >
                      {connecting ? 'Sending…' : `Connect with ${profile.nickname}`}
                    </button>
                    <Link className="up-btn up-btn-outline" to="/talk">Open Talk</Link>
                  </>
                )}

                {profile.canConnect && requestSent && (
                  <button type="button" className="up-btn up-btn-outline" onClick={load}>
                    ↻ Check again
                  </button>
                )}

                {!profile.isSignedIn && (
                  <>
                    <Link className="up-btn" to="/login">Sign in</Link>
                    <Link className="up-btn up-btn-outline" to="/register">Create your page</Link>
                  </>
                )}
              </div>

              {connectNotice && (
                <p
                  className={`up-notice ${connectNotice.tone === 'ok' ? 'up-notice--ok' : 'up-notice--error'}`}
                  role="status"
                >
                  {connectNotice.text}
                </p>
              )}
            </div>
          </section>

          <section className="up-band up-band--cta">
            <div className="up-wrap up-cta">
              <p className="up-band-eyebrow up-band-eyebrow--cta">Your turn</p>
              <h2 className="up-heading up-heading--cta">
                Keep your own page private, or open it to everyone
              </h2>
              <p className="up-lead up-lead--cta">
                Every page starts private — you, and the people you connect with. Publish it from
                your profile whenever you want the whole web to see it.
              </p>
              <div className="up-actions">
                <Link className="up-btn up-btn-inv" to={user ? '/talk' : '/register'}>
                  {user ? 'Open Talk' : 'Create your page'}
                </Link>
                {user && <Link className="up-btn up-btn-ghost" to="/profile">Your privacy setting</Link>}
              </div>
            </div>
          </section>
        </div>

        <Footer />
      </>
    );
  }

  const stats = profileStats(profile);
  const games = Array.isArray(profile.games) ? profile.games : [];
  const published = Array.isArray(profile.published) ? profile.published : [];

  const isPublic = isPublicVisibility(profile);

  return (
    <>
      <SEO
        title={profile.nickname}
        description={`${profile.nickname} on STHopwood — their games, published skills and goals.`}
        path={`/u/${username}`}
        // Only a public page belongs in a search index. The owner can read their
        // own private page, and to a connected visitor the page renders in full —
        // neither fact makes it public, so the tag follows the setting, not the
        // viewer's access.
        noindex={!isPublic}
      />
      <Header />

      <div className="up">
        {/* ── Hero: face, name, and the one action that matters ── */}
        <section className="up-hero">
          <div className="up-floating" aria-hidden="true">
            <div className="up-circle up-circle-1" />
            <div className="up-circle up-circle-2" />
            <div className="up-circle up-circle-3" />
          </div>

          <div className="up-hero-wrap">
            <ProfileAvatar picture={profile.avatar} name={profile.nickname} size="lg" />
            <p className="up-eyebrow">{profile.isSelf ? 'Your public page' : 'Member'}</p>
            <h1 className="up-title">{profile.nickname}</h1>
            {memberSinceLabel(profile.memberSince) && (
              <p className="up-subtitle">{memberSinceLabel(profile.memberSince)}</p>
            )}

            <div className="up-actions">
              {profile.isSelf && (
                <>
                  <Link className="up-btn" to="/settings#identity">Edit your profile</Link>
                  <Link className="up-btn up-btn-outline" to="/talk">Go to Talk</Link>
                </>
              )}

              {profile.isConnected && profile.connectedUserId && (
                <>
                  <Link className="up-btn" to={`/net?with=${encodeURIComponent(profile.connectedUserId)}`}>
                    Message {profile.nickname}
                  </Link>
                  <Link className="up-btn up-btn-outline" to="/talk">All connections</Link>
                </>
              )}

              {profile.canConnect && (
                <>
                  <button
                    type="button"
                    className="up-btn"
                    onClick={handleConnect}
                    disabled={connecting || requestSent}
                  >
                    {connecting ? 'Sending…' : requestSent ? 'Request sent' : `Connect with ${profile.nickname}`}
                  </button>
                  <Link className="up-btn up-btn-outline" to="/talk">Open Talk</Link>
                </>
              )}

              {!profile.isSignedIn && (
                <>
                  <Link className="up-btn" to="/register">Create your page</Link>
                  <Link className="up-btn up-btn-outline" to="/login">Sign in</Link>
                </>
              )}
            </div>

            {connectNotice && (
              <p
                className={`up-notice ${connectNotice.tone === 'ok' ? 'up-notice--ok' : 'up-notice--error'}`}
                role="status"
              >
                {connectNotice.text}
              </p>
            )}

            {/* Only the owner gets told which setting is in force — to a visitor
                every private page looks the same (locked), and to a connection it
                simply looks like a page. */}
            {profile.isSelf && (
              <p className={`up-visibility up-visibility--${isPublic ? 'public' : 'private'}`}>
                <span aria-hidden="true">{isPublic ? '🌐' : '🔒'}</span>
                {visibilityLabel(profile)} — {visibilitySummary(profile)}{' '}
                <Link className="up-visibility-link" to="/profile">Change</Link>
              </p>
            )}

            {stats.length > 0 ? (
              <ul className="up-stats">
                {stats.map((stat) => (
                  <li className="up-stat" key={stat.key}>
                    <strong className="up-stat-value">{stat.value}</strong>
                    <span className="up-stat-label">{stat.label}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="up-quiet">
                Nothing public on this page yet — it fills in as they play games and publish work.
              </p>
            )}
          </div>
        </section>

        {/* ── Games ── */}
        {games.length > 0 && (
          <RevealBand tone="surface" label="Games">
            <div className="up-head">
              <p className="up-band-eyebrow">On the boards</p>
              <h2 className="up-heading">Games</h2>
              <p className="up-lead">
                From the public leaderboards. Entries there are posted by the players themselves,
                so treat these as self-reported rather than verified.
              </p>
            </div>

            <div className="up-grid">
              {games.map((game) => {
                const summary = boardSummary(game);
                return (
                  <article className="up-card up-card--game" key={game.key}>
                    <h3 className="up-card-title">{game.name}</h3>
                    {game.title && <p className="up-card-sub">{game.title}</p>}

                    <p className="up-card-value">
                      {summary.value}
                      <span className="up-card-value-label">{summary.label}</span>
                    </p>

                    <ul className="up-card-facts">
                      {summary.detail && <li>{summary.detail}</li>}
                      {summary.rank && <li>{summary.rank}</li>}
                      {shortDate(game.at) && <li>Last played {shortDate(game.at)}</li>}
                    </ul>

                    <Link className="up-card-link" to={game.href}>
                      {playLabel(game)} <span aria-hidden="true">→</span>
                    </Link>
                  </article>
                );
              })}
            </div>
          </RevealBand>
        )}

        {/* ── Published work ── */}
        {published.length > 0 && (
          <RevealBand tone="tint" label="Published work">
            <div className="up-head">
              <p className="up-band-eyebrow">Shared</p>
              <h2 className="up-heading">Published work</h2>
              <p className="up-lead">
                Skills and goals {profile.nickname} chose to publish to the market, where anyone
                can save a copy.
              </p>
            </div>

            <div className="up-grid">
              {published.map((item) => (
                <article className="up-card" key={item.marketId}>
                  <p className="up-chip">{publishedKindLabel(item.kind)}</p>
                  <h3 className="up-card-title">{item.name}</h3>
                  {item.description && <p className="up-card-sub">{item.description}</p>}

                  <ul className="up-card-facts">
                    <li>{ratingLabel(item.ratingCount, item.avgRating)}</li>
                    <li>{formatNumber(item.downloads)} {Number(item.downloads) === 1 ? 'download' : 'downloads'}</li>
                    {shortDate(item.publishedAt) && <li>Published {shortDate(item.publishedAt)}</li>}
                  </ul>

                  <Link className="up-card-link" to="/market">
                    Open the market <span aria-hidden="true">→</span>
                  </Link>
                </article>
              ))}
            </div>
          </RevealBand>
        )}

        {/* ── The closing band: every Discovery page ends on one (§5) ── */}
        <section className="up-band up-band--cta">
          <div className="up-wrap up-cta">
            <p className="up-band-eyebrow up-band-eyebrow--cta">
              {profile.isSelf ? (isPublic ? 'Share it' : 'Not shared yet') : 'Your turn'}
            </p>
            <h2 className="up-heading up-heading--cta">
              {profile.isSelf
                ? (isPublic
                  ? 'This page is yours to share'
                  : 'Only your connections can see this page')
                : 'Every member gets a page like this'}
            </h2>
            <p className="up-lead up-lead--cta">
              {profile.isSelf
                ? (isPublic
                  // "Send it to anyone" is only true while the page is public — the
                  // page would be lying to its own owner otherwise, which is exactly
                  // the mistake the default-private setting exists to avoid.
                  ? 'Send the link to anyone — it shows your games and what you have published, and nothing private.'
                  : 'Publish it from your profile and the link works for anyone. Until then, someone without a connection sees only that the page is private.')
                : 'Play a game, publish a skill, add a profile picture, and yours fills itself in.'}
            </p>
            <div className="up-actions">
              {profile.isSelf ? (
                isPublic ? (
                  <Link className="up-btn up-btn-inv" to="/projects">Find something to play</Link>
                ) : (
                  <>
                    <Link className="up-btn up-btn-inv" to="/profile">Change who can see it</Link>
                    <Link className="up-btn up-btn-ghost" to="/talk">See your connections</Link>
                  </>
                )
              ) : (
                <>
                  <Link className="up-btn up-btn-inv" to={user ? '/talk' : '/register'}>
                    {user ? 'Open Talk' : 'Create your page'}
                  </Link>
                  <Link className="up-btn up-btn-ghost" to="/projects">See the projects</Link>
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      <Footer />
    </>
  );
}

export default UserProfile;
