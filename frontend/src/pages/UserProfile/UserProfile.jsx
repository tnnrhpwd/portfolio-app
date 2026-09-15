import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import SEO from '../../components/SEO/SEO.jsx';
import Spinner from '../../components/Spinner/Spinner.jsx';
import ProfileAvatar from '../../components/ProfilePicture/ProfileAvatar.jsx';
import ShareProfile from '../../components/ShareProfile/ShareProfile.jsx';
import { getPublicProfile } from '../../services/publicProfileApi.js';
import {
  blockMessengerUser,
  removeMessengerContact,
  sendFriendRequest,
  unblockMessengerUser,
} from '../../services/messengerApi.js';
import { messengerErrorMessage } from '../../utils/talkUtils.js';
import {
  RELATIONSHIP,
  blockConfirmText,
  blockNoticeText,
  boardSummary,
  canBlock,
  canRemoveConnection,
  canUnblock,
  formatNumber,
  isPublicVisibility,
  memberSinceValue,
  playLabel,
  profilePath,
  profileRelationship,
  profileStats,
  publishedKindLabel,
  ratingLabel,
  removeConfirmText,
  removeNoticeText,
  shortDate,
  unblockConfirmText,
  unblockNoticeText,
  visibilityAudience,
  visibilityLabel,
} from '../../utils/userProfileUtils.js';
import './UserProfile.css';

/**
 * UserProfile — the member page, at `/u/<username>`.
 *
 * A SERVICE PAGE (FRONTEND_UI_STANDARD.md §5.7). This is the page a member sends
 * someone, and the one they open to check what a stranger sees — a room, not a
 * pitch. So there are no bands and no gradient behind the numbers: one flat ground
 * (the shared `.service-room`), one row at the top carrying the name, its live
 * state and the one action, and a dense grid of glass panes below it. Nothing of
 * the page's own is pinned, and nothing fades in — the site header is the only
 * thing that stays put.
 *
 * Where the numbers come from, and how much they can be trusted, differs — so the
 * page says it rather than presenting everything as an achievement record:
 *
 *   - identity, join date        → the account row
 *   - games                      → the PUBLIC game leaderboards. Those rows are
 *                                  self-reported by whoever posted them, and the
 *                                  panel's hint says so (see services/gameBoards.js).
 *   - published skills/goals      → `authorUserId` is stamped by the server on
 *                                  publish, so this is genuinely attributable.
 *
 * One `<h1>` (the name) and one `<h2>` per panel, and a panel with nothing in it
 * is not rendered at all — an empty "Games" pane is worse than no pane.
 *
 * MANAGING THE RELATIONSHIP (§19.4). The two controls that change it — remove the
 * connection, and block — are NOT in the row. The row's buttons are for engaging
 * with a person, and a destructive control parked next to "Message" is a misclick
 * waiting to happen. They live in a folded `<details>` pane, which §5.7 asks for
 * by name, and which doubles as the only place a block can be LIFTED: the summary
 * carries a `Blocked` badge, so the pane announces its own state while closed.
 * The row is left with no action at all in that state, because a block has already
 * switched off everything this page's actions do.
 */

/** One pane of the room: a title row, an optional hint, its rows, an optional foot. */
function Panel({ title, hint, foot, children }) {
  return (
    <section className="up-panel">
      <div className="up-panel-head">
        <h2 className="up-panel-title">{title}</h2>
      </div>
      {hint && <p className="up-panel-hint">{hint}</p>}
      {children}
      {foot && <div className="up-panel-foot">{foot}</div>}
    </section>
  );
}

/**
 * The room's row: the name, its live state and the one action (§5.7). NOT pinned
 * — the site header is the only thing that stays at the top of the page, so this
 * scrolls away with everything below it.
 */
function ProfileBar({ title, avatar, lock, readout, actions, notice }) {
  return (
    <>
      <header className="up-bar">
        {avatar}
        {lock && <span className="up-bar-lock" aria-hidden="true">{lock}</span>}
        <h1 className="up-bar-title">{title}</h1>
        {readout && <ul className="up-bar-readout">{readout}</ul>}
        {actions && <div className="up-bar-actions">{actions}</div>}
      </header>

      {notice && (
        <p className={`up-notice up-notice--${notice.tone === 'ok' ? 'ok' : 'error'}`} role="status">
          {notice.text}
        </p>
      )}
    </>
  );
}

/**
 * The controls that change the relationship, folded away.
 *
 * `§5.7` — "power-user plumbing goes in a `<details>`, so the first screen is the
 * job and not the config" — and the two controls here are exactly that: removing a
 * connection and blocking are not what this page is FOR, and both are destructive.
 *
 * It is a PANE like every other one in the grid, so it reads as part of the room
 * rather than as a stray menu, and the panel is its own confirm step on the way in.
 * The badge on the summary is load-bearing: it is the only place a block announces
 * itself while the pane is shut, and a block you cannot find is a block you cannot
 * lift — the row carries no action at all in that state (§19.4).
 *
 * Renders nothing when there is nothing to manage, so it never appears on your own
 * page, for a signed-out visitor, or for a state with no available control.
 */
function ManagePanel({ profile, busy, onBlock, onUnblock, onRemove }) {
  const showRemove = canRemoveConnection(profile);
  const showUnblock = canUnblock(profile);
  const showBlock = canBlock(profile);

  if (!showRemove && !showUnblock && !showBlock) return null;

  const nickname = profile.nickname;

  return (
    <details className="up-panel up-panel--manage">
      <summary className="up-manage-summary">
        Manage
        {showUnblock && <span className="up-kind up-kind--alert">Blocked</span>}
      </summary>

      <div className="up-manage-body">
        {showRemove && (
          <div className="up-row">
            <span className="up-row-key">Remove connection</span>
            <button
              type="button"
              className="up-btn up-btn--outline up-btn--sm"
              onClick={() => onRemove(nickname)}
              disabled={busy}
            >
              Remove
            </button>
          </div>
        )}

        {showBlock && (
          <div className="up-row">
            <span className="up-row-key">Block</span>
            <button
              type="button"
              className="up-btn up-btn--alert up-btn--sm"
              onClick={() => onBlock(nickname)}
              disabled={busy}
            >
              Block
            </button>
          </div>
        )}

        {showUnblock && (
          <div className="up-row">
            <span className="up-row-key">Blocked</span>
            <button
              type="button"
              className="up-btn up-btn--outline up-btn--sm"
              onClick={() => onUnblock(nickname)}
              disabled={busy}
            >
              Unblock
            </button>
          </div>
        )}

        {/* The one thing the word "Block" does not say. It is the only sentence in
            the pane, and it earns its place: a block is the one control here whose
            effect is invisible to the other person, and whose scope (the page, the
            requests, the messaging) cannot be guessed from the label. */}
        {(showBlock || showUnblock) && (
          <p className="up-note">
            {showUnblock
              ? 'Unblocking does not reconnect you. Your messages are kept either way.'
              : 'Blocking hides your page from them and stops new requests and messages. They are not told.'}
          </p>
        )}
      </div>
    </details>
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
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [requestSent, setRequestSent] = useState(false);
  const [sharing, setSharing] = useState(false);

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
    setNotice(null);
    try {
      const result = await sendFriendRequest(token, profile.nickname);
      setRequestSent(true);

      // Whether this request was accepted on the spot (they had already asked us)
      // decides the copy, and on the private page it decides more than that: the
      // lock exists because we were not connected, so becoming connected means the
      // page we are looking at is now readable. Re-fetch instead of claiming to
      // have sent a request against a page we could already be reading.
      if (result.autoAccepted) {
        setNotice({ tone: 'ok', text: `You are connected with ${profile.nickname} now.` });
        await load();
        return;
      }

      setNotice({
        tone: 'ok',
        text: `Request sent to ${profile.nickname}. They will see it next time they open Talk.`,
      });
    } catch (err) {
      setNotice({ tone: 'error', text: messengerErrorMessage(err, 'Could not send that request.') });
    } finally {
      setConnecting(false);
    }
  }, [profile, token, load]);

  /**
   * The three relationship controls, and why they are one function.
   *
   * All three change state that this page does not own — the friend graph, and a
   * block the server holds — so none of them writes a local flag and guesses. Each
   * one calls the API and then RE-READS the profile, because the payload is what
   * decides the row's action, the readout chips and which controls exist at all
   * (`profileRelationship`). Setting `blockedByYou` here instead would be a second
   * copy of the server's rule, and the two would eventually disagree about a page
   * that is private, a block that is already there, or a connection that was
   * removed on the other side.
   *
   * A `window.confirm` in front of each is the same choice `/talk` makes for
   * "Remove": these are irreversible-by-accident (a removed connection has to be
   * re-requested), the confirm is the only place the consequence is stated, and it
   * costs nothing to keep.
   */
  const runRelationshipAction = useCallback(async (confirmText, action, say) => {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await load();
      setNotice({ tone: 'ok', text: say });
    } catch (err) {
      setNotice({ tone: 'error', text: messengerErrorMessage(err, 'That did not work. Please try again.') });
    } finally {
      setBusy(false);
    }
  }, [load]);

  const handleBlock = useCallback((nickname) => runRelationshipAction(
    blockConfirmText(nickname),
    () => blockMessengerUser(token, nickname),
    blockNoticeText(nickname)
  ), [runRelationshipAction, token]);

  const handleUnblock = useCallback((nickname) => runRelationshipAction(
    unblockConfirmText(nickname),
    () => unblockMessengerUser(token, nickname),
    unblockNoticeText(nickname)
  ), [runRelationshipAction, token]);

  // The one of the three that IS id-addressed: removing a connection is `/talk`'s
  // operation, and a connection is exactly the state in which this page holds the
  // peer's id (`connectedUserId`). A block, which removes that id from reach, is
  // handle-addressed for the same reason — see `messengerApi.js`.
  const handleRemove = useCallback((nickname) => runRelationshipAction(
    removeConfirmText(nickname),
    () => removeMessengerContact(token, profile.connectedUserId),
    removeNoticeText(nickname)
  ), [runRelationshipAction, token, profile]);

  // A stable identity, because the sheet subscribes once while it is open: an
  // inline arrow would re-bind the Escape listener on every render of this page.
  const closeSharing = useCallback(() => setSharing(false), []);

  // ── Loading / not-found / failed ────────────────────────────────────────────
  // All three keep the page shell, so a bad link looks like a page rather than
  // like something broke. The row names the handle that was asked for and states
  // what happened to it; the panel is the one place with room for a sentence.
  if (status !== 'ready') {
    const state = status === 'loading' ? 'Loading' : (status === 'missing' ? 'Not found' : 'Unavailable');

    const actions = status === 'missing' ? (
      <>
        <Link className="up-btn up-btn--primary" to="/talk">Find someone on Talk</Link>
        {!user && <Link className="up-btn up-btn--outline" to="/register">Create your page</Link>}
      </>
    ) : status === 'error' ? (
      <>
        <button type="button" className="up-btn up-btn--primary" onClick={load}>↻ Try again</button>
        <Link className="up-btn up-btn--outline" to="/talk">Open Talk</Link>
      </>
    ) : null;

    return (
      <>
        <SEO title="Profile" description="A member profile on STHopwood." path={`/u/${username}`} />
        <Header />

        <div className="up-page service-room">
          <div className="up-shell">
            <ProfileBar
              title={username || 'Member page'}
              readout={(
                <li className="up-chip">
                  <span className="up-chip-key">Page</span>
                  <strong>{state}</strong>
                </li>
              )}
              actions={actions}
            />

            <div className="up-rows">
              <Panel title="Member page">
                {status === 'loading' && <Spinner />}
                {status === 'missing' && (
                  <p className="up-note">
                    Nobody here goes by that name. A member page uses the same name as Talk.
                  </p>
                )}
                {status === 'error' && <p className="up-note">{error}</p>}
              </Panel>
            </div>
          </div>
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
  // stats, no boards, no published work. So the panel is a list of what is being
  // held back, which is a label per line rather than a paragraph.
  if (profile.restricted) {
    // A block this viewer placed is the one state where the row carries NO action:
    // `canConnect` is false (the server will not offer to connect someone to an
    // account they have blocked), and the only thing left to do — lift it — is
    // plumbing, so it lives in the Manage pane with the rest of the plumbing.
    //
    // For a viewer who was BLOCKED, none of this branch changes anything: no chip,
    // no pane, no action beyond the Connect button the private page already offers.
    // That is the point — the two states render identically, because the server
    // answers them identically (`services/publicProfile.js`).
    const blockedByYou = canUnblock(profile);

    const actions = blockedByYou ? null : profile.canConnect ? (
      <>
        <button
          type="button"
          className="up-btn up-btn--primary"
          onClick={handleConnect}
          disabled={connecting || requestSent}
        >
          {connecting ? 'Sending…' : (requestSent ? 'Request sent' : `Connect with ${profile.nickname}`)}
        </button>
        <Link className="up-btn up-btn--outline" to="/talk">Open Talk</Link>
      </>
    ) : !profile.isSignedIn ? (
      <>
        <Link className="up-btn up-btn--primary" to="/login">Sign in</Link>
        <Link className="up-btn up-btn--outline" to="/register">Create your page</Link>
      </>
    ) : null;

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

        <div className="up-page service-room">
          <div className="up-shell">
            <ProfileBar
              lock="🔒"
              title={profile.nickname}
              readout={(
                <>
                  <li className="up-chip">
                    <span className="up-chip-key">Page</span>
                    <strong>Private</strong>
                  </li>
                  <li className="up-chip">
                    <span className="up-chip-key">Access</span>
                    <strong>{blockedByYou ? 'Blocked' : 'Connections only'}</strong>
                  </li>
                </>
              )}
              actions={actions}
              notice={notice}
            />

            <div className="up-rows">
              <Panel title="What stays hidden">
                <ul className="up-list">
                  <li className="up-row">
                    <span className="up-row-key">Picture</span>
                    <span className="up-row-value">Hidden</span>
                  </li>
                  <li className="up-row">
                    <span className="up-row-key">Games</span>
                    <span className="up-row-value">Hidden</span>
                  </li>
                  <li className="up-row">
                    <span className="up-row-key">Published work</span>
                    <span className="up-row-value">Hidden</span>
                  </li>
                  <li className="up-row">
                    <span className="up-row-key">Connections</span>
                    <span className="up-row-value">Hidden</span>
                  </li>
                </ul>
              </Panel>

              <Panel
                title="How to open it"
                foot={requestSent && (
                  <button type="button" className="up-btn up-btn--outline up-btn--sm" onClick={load}>
                    ↻ Check again
                  </button>
                )}
              >
                {blockedByYou ? (
                  <p className="up-note">
                    You blocked {profile.nickname}. Unblocking lets them ask to connect again — that
                    does not reconnect you, and the page stays private until they accept.
                  </p>
                ) : requestSent ? (
                  <p className="up-note">
                    Waiting on {profile.nickname}. The page opens the moment they accept the request.
                  </p>
                ) : profile.canConnect ? (
                  <p className="up-note">
                    {profile.nickname} reads the request and decides. The page opens once they accept.
                  </p>
                ) : (
                  <p className="up-note">
                    Sign in first — then ask {profile.nickname} to connect, and the page opens once they accept.
                  </p>
                )}
              </Panel>

              {/* Last, like the full branch: plumbing after the content (§5.7). */}
              <ManagePanel
                profile={profile}
                busy={busy}
                onBlock={handleBlock}
                onUnblock={handleUnblock}
                onRemove={handleRemove}
              />
            </div>
          </div>
        </div>

        <Footer />
      </>
    );
  }

  const stats = profileStats(profile);
  const games = Array.isArray(profile.games) ? profile.games : [];
  const published = Array.isArray(profile.published) ? profile.published : [];

  const isPublic = isPublicVisibility(profile);
  const joined = memberSinceValue(profile.memberSince);
  const empty = games.length === 0 && published.length === 0;

  // The one action this page is for, which differs by who is looking: the owner
  // edits their page, a connection messages them, a stranger asks to connect, and
  // a signed-out visitor can only get an account of their own (§5.7).
  //
  // ⚠️ The four cases are read off `profileRelationship` rather than re-derived
  // from `isConnected`/`canConnect` here, and the BLOCKED case has no action at
  // all. Both are deliberate. The relationship is one fact with one definition
  // (utils/userProfileUtils.js), so the row and the Manage pane below it cannot
  // disagree about which state this page is in; and a block has already switched
  // off everything this row's buttons do — messaging needs a connection, and
  // connecting is the one thing the viewer has refused. Lifting the block is a
  // settings change, so it lives in the Manage pane.
  const relationship = profileRelationship(profile);

  const relationshipActions = relationship === RELATIONSHIP.SELF ? (
    <>
      <Link className="up-btn up-btn--primary" to="/settings#identity">Edit your profile</Link>
      <Link className="up-btn up-btn--outline" to="/profile">Who can see it</Link>
    </>
  ) : relationship === RELATIONSHIP.CONNECTED ? (
    <>
      <Link className="up-btn up-btn--primary" to={`/net?with=${encodeURIComponent(profile.connectedUserId)}`}>
        Message {profile.nickname}
      </Link>
      <Link className="up-btn up-btn--outline" to="/talk">All connections</Link>
    </>
  ) : relationship === RELATIONSHIP.STRANGER ? (
    <>
      <button
        type="button"
        className="up-btn up-btn--primary"
        onClick={handleConnect}
        disabled={connecting || requestSent}
      >
        {connecting ? 'Sending…' : (requestSent ? 'Request sent' : `Connect with ${profile.nickname}`)}
      </button>
      <Link className="up-btn up-btn--outline" to="/talk">Open Talk</Link>
    </>
  ) : relationship === RELATIONSHIP.VISITOR ? (
    <>
      <Link className="up-btn up-btn--primary" to="/register">Create your page</Link>
      <Link className="up-btn up-btn--outline" to="/login">Sign in</Link>
    </>
  ) : null;

  /**
   * The share sheet, appended to whatever the relationship offers.
   *
   * `outline` on purpose: this page's ONE filled control is its action, and
   * handing someone the address is not the same offer as messaging them.
   *
   * ⚠️ Every case EXCEPT a block. The blocked row is deliberately actionless — a
   * block has already switched off everything these buttons do (see above) — and
   * "here is their address, pass it on" is not compatible with that, least of all
   * for the one viewer the owner has just closed the door on. `/u/<name>` behind a
   * lock (the `restricted` branch) offers no share either: it renders no action row
   * at all, which is the same principle stated earlier in the page.
   */
  const actions = (
    <>
      {relationshipActions}
      {relationship !== RELATIONSHIP.BLOCKED && (
        <button type="button" className="up-btn up-btn--outline" onClick={() => setSharing(true)}>
          Share profile
        </button>
      )}
    </>
  );

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

      <div className="up-page service-room">
        <div className="up-shell">
          <ProfileBar
            avatar={<ProfileAvatar picture={profile.avatar} name={profile.nickname} size="sm" />}
            title={profile.nickname}
            readout={[
              // The page's own state is news only to the person who owns it: to a
              // visitor the page is simply readable, and a chip saying so is noise.
              profile.isSelf && (
                <li className="up-chip" key="visibility">
                  <span className="up-chip-key">Page</span>
                  <strong>{visibilityLabel(profile)}</strong>
                </li>
              ),
              // ...but a BLOCK is the viewer's own state, and it is news to them
              // every time: it explains an absent Message button, and the one
              // control they are looking for is in the pane below.
              relationship === RELATIONSHIP.BLOCKED && (
                <li className="up-chip" key="blocked">
                  <span className="up-chip-key">Access</span>
                  <strong>Blocked</strong>
                </li>
              ),
              joined && (
                <li className="up-chip" key="joined">
                  <span className="up-chip-key">Member since</span>
                  <strong>{joined}</strong>
                </li>
              ),
              ...stats.map((stat) => (
                <li className="up-chip" key={stat.key}>
                  <span className="up-chip-key">{stat.label}</span>
                  <strong>{stat.value}</strong>
                </li>
              )),
            ]}
            actions={actions}
            notice={notice}
          />

          <div className="up-rows">
            {games.length > 0 && (
              <Panel title="Games" hint="Self-reported on the public leaderboards.">
                <ul className="up-list">
                  {games.map((game) => {
                    const summary = boardSummary(game);
                    return (
                      <li className="up-entry" key={game.key}>
                        <div className="up-entry-main">
                          <h3 className="up-entry-title">{game.name}</h3>
                          {game.title && <p className="up-entry-sub">{game.title}</p>}

                          <ul className="up-entry-facts">
                            {summary.detail && <li>{summary.detail}</li>}
                            {summary.rank && <li>{summary.rank}</li>}
                            {shortDate(game.at) && <li>Played {shortDate(game.at)}</li>}
                          </ul>
                        </div>

                        <div className="up-entry-aside">
                          <p className="up-entry-value">
                            {summary.value}
                            <span className="up-entry-value-label">{summary.label}</span>
                          </p>
                          <Link className="up-entry-link" to={game.href}>
                            {playLabel(game)} <span aria-hidden="true">→</span>
                          </Link>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            )}

            {published.length > 0 && (
              <Panel title="Published work">
                <ul className="up-list">
                  {published.map((item) => (
                    <li className="up-entry" key={item.marketId}>
                      <div className="up-entry-main">
                        <h3 className="up-entry-title">{item.name}</h3>
                        {item.description && <p className="up-entry-sub">{item.description}</p>}

                        <ul className="up-entry-facts">
                          <li>{ratingLabel(item.ratingCount, item.avgRating)}</li>
                          <li>
                            {formatNumber(item.downloads)}{' '}
                            {Number(item.downloads) === 1 ? 'download' : 'downloads'}
                          </li>
                          {shortDate(item.publishedAt) && <li>Published {shortDate(item.publishedAt)}</li>}
                        </ul>
                      </div>

                      <div className="up-entry-aside">
                        <p className="up-kind">{publishedKindLabel(item.kind)}</p>
                        <Link className="up-entry-link" to="/market">
                          Open the market <span aria-hidden="true">→</span>
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {empty && (
              <Panel title={profile.isSelf ? 'Nothing here yet' : 'Nothing public yet'}>
                <p className="up-note">
                  {profile.isSelf
                    ? 'Play a game or publish a skill, and it appears on this page.'
                    : `${profile.nickname} has not posted a board entry or published anything yet.`}
                </p>
              </Panel>
            )}

            {/* The owner's own settings, as rows. Changing them stays on `/profile`:
                one write path for the setting, and this page only reads it. */}
            {profile.isSelf && (
              <Panel
                title="Your page"
                foot={<Link className="up-btn up-btn--outline up-btn--sm" to="/profile">Change on your profile</Link>}
              >
                <ul className="up-list">
                  <li className="up-row">
                    <span className="up-row-key">Visibility</span>
                    <span className="up-row-value">{visibilityLabel(profile)}</span>
                  </li>
                  <li className="up-row">
                    <span className="up-row-key">Audience</span>
                    <span className="up-row-value">{visibilityAudience(profile)}</span>
                  </li>
                  <li className="up-row">
                    <span className="up-row-key">Address</span>
                    <code className="up-row-code">{profilePath(profile.nickname)}</code>
                  </li>
                </ul>
              </Panel>
            )}

            {/* LAST, deliberately. §5.7 orders a service page's panes by how often
                the user touches them (what you watch → what you run → what you keep
                → settings), and this is settings. Folded away it is one row, and it
                should not push the games and the published work — the things this
                page is FOR — any further down. */}
            <ManagePanel
              profile={profile}
              busy={busy}
              onBlock={handleBlock}
              onUnblock={handleUnblock}
              onRemove={handleRemove}
            />
          </div>
        </div>

        {/* Floats over the room rather than sitting in a panel: it is a modal, and
            the page owns the open state so navigating away unmounts it. */}
        <ShareProfile name={profile.nickname} open={sharing} onClose={closeSharing} />
      </div>

      <Footer />
    </>
  );
}

export default UserProfile;
