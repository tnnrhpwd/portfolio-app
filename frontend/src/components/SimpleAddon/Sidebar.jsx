import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getLocalModels, testAddonConnection, runAddonSingleClickUpdate } from '../../services/simpleAddonApi';
import { getMessengerDirectory } from '../../services/messengerApi.js';
import useAvatars from '../../hooks/useAvatars.js';
import { publishTalkUnread, sumUnread } from '../../utils/talkUnread.js';
import TalkAvatar from '../Simple/Talk/TalkAvatar.jsx';
import TalkUnreadBadge from '../Simple/Talk/TalkUnreadBadge.jsx';
import { ADDON_DOWNLOAD_URL } from '../../hooks/simpleAddon/useAddonDetection';
import { cloudModelChoicePatch, cloudProviderSummary } from '../../utils/llmProviderOptions.js';
import { DEFAULT_LOCAL_PROVIDER, providerLabel } from '../../constants/aiModel.js';
import CloudModelSelect from './CloudModelSelect';
import UsageMeter from './UsageMeter';
import StorageMeter from './StorageMeter';
import AgentLivePanel from './AgentLivePanel';
import { isGoalConversation, goalSlugFromConversation } from '../../utils/simpleAddon/goalChat';
import './Sidebar.css';

/**
 * The rail's ACCOUNT METERS — the AI credits meter with its "upgrade for more
 * credits" link, and the storage meter — are hidden for now, for every account.
 *
 * ⚠️ A flag, not a deletion, because this is a "for now": `UsageMeter` and
 * `StorageMeter` are untouched (their styles, their `/usage` poll and the
 * upgrade control inside `UsageMeter` all stay), so bringing them back is this
 * one word. Nothing else in the rail reads either component, and they are the
 * only callers of `/usage` in this tree — so nothing moves with them except the
 * poll, which stops.
 *
 * The rail is shared with the addon renderer, so this hides them there too: the
 * ask was "for all users", and an account's credits are the same number on both
 * surfaces.
 */
const SHOW_ACCOUNT_METERS = false;

function Sidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  selectedModel,
  onSelectModel,
  settings,
  onSettingsChange,
  onOpenAdvancedSettings,
  isOpen,
  onClose,
  isOnline,
  isAddonConnected,
  portfolioLLMProviders,
  user,
  showAddonPrompt = false,
  addonPromptOutdated = false,
  addonPromptChecking = false,
  addonNeedsCertTrust = false,
  addonNeedsOptIn = false,
  onAddonRecheck,
  onAddonDismiss,
  onAddonEnableOptIn,
  addonCurrentVersion,
  addonRequiredVersion,
  /**
   * The messenger's handle on this rail's People section — `{ token,
   * activePeerId }`, or null.
   *
   * Handed in rather than fetched from inside, because the addon renderer's copy
   * of this component must not grow a webapp-only list: with no `messenger`
   * prop the section does not render at all.
   */
  messenger = null,
}) {
  const [models, setModels] = useState([]);
  /**
   * Which section of the rail is open — ONE at a time.
   *
   * ⚠️ One piece of state, not four booleans. This rail is a narrow column of
   * stacked lists and panels: two open sections push whatever you were reading
   * off the bottom of it, and independent flags allow every combination —
   * including two sections fighting over the same vertical space.
   *
   * `'people'` is the default because it is what `/net` is for (a person's
   * thread) and it is the short list; the AI history stays opt-in, so the rail
   * still reads as "New Chat + who you talk to + agent status".
   */
  const [openSection, setOpenSection] = useState('people');

  /** Opening a section closes whichever was open; the open one closes itself. */
  const toggleSection = (name) => setOpenSection((current) => (current === name ? null : name));
  const [addonTest, setAddonTest] = useState({ state: 'idle', checks: [] });
  // Single-click self-update: 'idle' | 'updating' | 'error' | 'unsupported'
  const [updateNow, setUpdateNow] = useState({ state: 'idle', progress: 0, error: null });

  const handleUpdateNow = useCallback(async () => {
    if (updateNow.state === 'updating') return;
    setUpdateNow({ state: 'updating', progress: 0, error: null });
    try {
      await runAddonSingleClickUpdate((status) => {
        setUpdateNow({ state: 'updating', progress: status.downloadProgress || 0, error: null });
      });
      // Addon is about to quit & relaunch itself — leave the button in its
      // "updating" state until the page's own addon-polling notices the restart.
    } catch (e) {
      if (e.code === 'unsupported') {
        // The currently-running addon predates the /api/update/* routes, so
        // this webpage has no way to drive its updater over HTTP. It is NOT
        // stuck, though: the addon's own background auto-updater has already
        // been silently checking (every 4h) and auto-downloading since it
        // started — no browser round-trip needed, no approval dialogs, ever.
        // The fastest path is the system tray it's already running in, not a
        // browser download+install. Don't open a browser tab for this.
        setUpdateNow({ state: 'unsupported', progress: 0, error: e.message });
        return;
      }
      setUpdateNow({ state: 'error', progress: 0, error: e.message });
      setTimeout(() => setUpdateNow(prev => prev.state === 'error' ? { state: 'idle', progress: 0, error: null } : prev), 6000);
    }
  }, [updateNow.state]);

  const runAddonTest = useCallback(async () => {
    if (addonTest.state === 'testing') return;
    setAddonTest({ state: 'testing', checks: [] });
    try {
      const result = await testAddonConnection();
      setAddonTest({ state: result.passed ? 'passed' : 'failed', checks: result.checks });
    } catch {
      setAddonTest({ state: 'failed', checks: [{ name: 'Connection', ok: false, detail: 'Test threw an error' }] });
    }
    setTimeout(() => setAddonTest(prev => prev.state !== 'testing' ? { state: 'idle', checks: [] } : prev), 6000);
  }, [addonTest.state]);

  const agents = settings?.agents || [];
  const selectedAgentId = settings?.selectedAgentId || 'default';
  const isPortfolio = settings?.llmProvider === 'portfolio';

  // ── People: the other half of the conversation list ───────────────────────
  //
  // The rail is ONE list of conversations with two kinds of thread in it: the
  // assistant's (above) and a person's (here). A person's row carries what a
  // chat list row always carries — face, name, the last thing said, how much is
  // unread — and opens the same pane the assistant's does, at `/net?with=<id>`.
  const messengerToken = messenger?.token || '';
  const activePeerId = messenger?.activePeerId || '';
  const [people, setPeople] = useState([]);
  const peopleAvatars = useAvatars(
    useMemo(() => people.map((person) => person.userId), [people]),
    messengerToken,
  );

  useEffect(() => {
    if (!messengerToken) {
      setPeople([]);
      return undefined;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const directory = await getMessengerDirectory(messengerToken);
        if (!cancelled) setPeople(directory.contacts || []);
      } catch {
        // A rail that cannot list people is still a working chat: the AI side
        // and whichever transcript is open are unaffected, and the next poll
        // retries. Nothing here is worth a page-level error.
      }
    };

    load();
    // Unread counts and previews are the only things that move while the rail
    // sits open, so this is a slow poll rather than a subscription.
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
    // `activePeerId` is a dependency because opening a thread clears its unread
    // on the server — the rail should show that without waiting for a reload.
  }, [messengerToken, activePeerId]);

  const unreadTotal = useMemo(() => sumUnread(people), [people]);

  // The rail is already holding the dashboard, so the SITE's badges (the header
  // drawer, a member page's Talk buttons) read the count from here instead of
  // asking the server for the same payload a second time on every page.
  useEffect(() => {
    if (messengerToken) publishTalkUnread(messengerToken, unreadTotal);
  }, [messengerToken, unreadTotal]);

  // Fetch local models from addon when connected
  useEffect(() => {
    if (isAddonConnected) {
      getLocalModels()
        .then(data => setModels(data.models || []))
        .catch(() => setModels([]));
    } else {
      setModels([]);
    }
  }, [isAddonConnected]);

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${isOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar__header">
          <button className="sidebar__close" onClick={onClose} title="Close sidebar">
            ×
          </button>
        </div>

        <button 
          className="sidebar__new-chat" 
          onClick={onNewChat}
          disabled={!isOnline}
          title={isOnline ? "Create a new chat" : "Cannot create chat while offline"}
        >
          <span className="sidebar__new-chat-icon">+</span>
          New Chat
        </button>

        <div className="sidebar__conversations">
          <button
            className="sidebar__conversations-toggle"
            onClick={() => toggleSection('conversations')}
            aria-expanded={openSection === 'conversations'}
            aria-controls="sidebar-conversations-list"
            title={openSection === 'conversations' ? 'Hide conversations' : 'Show conversations'}
          >
            <span
              className={`sidebar__conversations-chevron ${openSection === 'conversations' ? 'sidebar__conversations-chevron--up' : ''}`}
              aria-hidden="true"
            >
              ▾
            </span>
            Conversations
            {conversations.length > 0 && (
              <span className="sidebar__conversations-count">{conversations.length}</span>
            )}
          </button>

          {openSection === 'conversations' && (
            <div className="sidebar__conversations-list" id="sidebar-conversations-list">
              {conversations.map(conv => {
                // A goal's thread wears the goal's own mark, so the list reads as
                // "my chats + the goals the agent is working on", not a pile of
                // identically-labelled conversations.
                const goalChat = isGoalConversation(conv);
                return (
                  <div
                    key={conv.id}
                    className={`sidebar__conv ${conv.id === activeConversationId ? 'sidebar__conv--active' : ''} ${goalChat ? 'sidebar__conv--goal' : ''}`}
                    onClick={() => onSelectConversation(conv.id)}
                  >
                    <span className="sidebar__conv-icon" aria-hidden="true">{goalChat ? '🎯' : '💬'}</span>
                    <span className="sidebar__conv-title" title={goalChat ? `Goal: ${goalSlugFromConversation(conv)}` : conv.title}>
                      {conv.title}
                    </span>
                    <button
                      className="sidebar__conv-delete"
                      onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.id); }}
                      title="Delete conversation"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {messengerToken && (
          <div className="sidebar__conversations sidebar__people">
            <button
              className="sidebar__conversations-toggle"
              onClick={() => toggleSection('people')}
              aria-expanded={openSection === 'people'}
              aria-controls="sidebar-people-list"
              title={openSection === 'people' ? 'Hide people' : 'Show people'}
            >
              <span
                className={`sidebar__conversations-chevron ${openSection === 'people' ? 'sidebar__conversations-chevron--up' : ''}`}
                aria-hidden="true"
              >
                ▾
              </span>
              People
              {people.length > 0 && (
                <span className="sidebar__conversations-count">{people.length}</span>
              )}
            </button>

            {openSection === 'people' && (
              <div className="sidebar__conversations-list" id="sidebar-people-list">
                {people.length === 0 ? (
                  <p className="sidebar__people-empty">
                    No conversations with anyone yet.{' '}
                    <Link className="sidebar__people-link" to="/talk">
                      Find someone →
                      <TalkUnreadBadge count={unreadTotal} />
                    </Link>
                  </p>
                ) : (
                  people.map((person) => (
                    <Link
                      key={person.userId}
                      className={`sidebar__conv sidebar__person ${person.userId === activePeerId ? 'sidebar__conv--active' : ''}`}
                      to={`/net?with=${encodeURIComponent(person.userId)}`}
                      onClick={onClose}
                      title={person.nickname}
                    >
                      <TalkAvatar
                        src={peopleAvatars[person.userId]}
                        name={person.nickname}
                        className="sidebar__person-avatar"
                      />
                      <span className="sidebar__person-body">
                        <span className="sidebar__conv-title">{person.nickname}</span>
                        {person.lastPreview && (
                          <span className="sidebar__person-preview">{person.lastPreview}</span>
                        )}
                      </span>
                      {person.unread > 0 && (
                        <span className="sidebar__person-unread">{person.unread}</span>
                      )}
                    </Link>
                  ))
                )}
                <Link className="sidebar__people-manage" to="/talk" onClick={onClose}>
                  Connections on Talk →
                  <TalkUnreadBadge count={unreadTotal} />
                </Link>
              </div>
            )}
          </div>
        )}

        <div className="sidebar__footer">
          {showAddonPrompt && addonNeedsOptIn && (
            <div className="sidebar__addon-notice">
              <span className="sidebar__addon-notice__icon">🔌</span>
              <div className="sidebar__addon-notice__body">
                <span className="sidebar__addon-notice__title">Enable local addon?</span>
                <span className="sidebar__addon-notice__sub">
                  Connects this page to Simple on your computer for local AI
                  &amp; automation. The browser will mark the page “Not Secure”
                  while connected (self‑signed cert on localhost).
                </span>
              </div>
              <div className="sidebar__addon-notice__actions">
                <button
                  className="sidebar__addon-notice__btn"
                  onClick={onAddonEnableOptIn}
                  disabled={addonPromptChecking}
                >
                  {addonPromptChecking ? '…' : 'Enable'}
                </button>
                <button
                  className="sidebar__addon-notice__dismiss"
                  onClick={onAddonDismiss}
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {showAddonPrompt && !addonNeedsOptIn && (
            <div className={`sidebar__addon-notice${addonPromptOutdated ? ' sidebar__addon-notice--update' : ''}`}>
              <span className="sidebar__addon-notice__icon">{addonPromptOutdated ? '⬆️' : '🧩'}</span>
              <div className="sidebar__addon-notice__body">
                <span className="sidebar__addon-notice__title">
                  {addonPromptOutdated
                    ? `Update addon v${addonRequiredVersion}`
                    : 'Addon not running'}
                </span>
                <span className="sidebar__addon-notice__sub">
                  {addonPromptOutdated
                    ? `v${addonCurrentVersion || '?'} installed`
                    : 'Start Simple to enable local AI & automation'}
                </span>
                {addonNeedsCertTrust && !addonPromptOutdated && (
                  <span className="sidebar__addon-notice__sub" style={{ marginTop: 4 }}>
                    Already installed? Browsers block the addon's self-signed
                    cert on HTTPS sites.{' '}
                    <a
                      href="https://localhost:3444/api/status"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ textDecoration: 'underline' }}
                    >
                      Click here
                    </a>
                    , choose “Advanced → Proceed”, then hit recheck.
                  </span>
                )}
                {addonPromptOutdated && updateNow.state === 'error' && (
                  <span className="sidebar__addon-notice__sub" style={{ marginTop: 4, color: '#e05d5d' }}>
                    {updateNow.error}
                  </span>
                )}
                {addonPromptOutdated && updateNow.state === 'unsupported' && (
                  <span className="sidebar__addon-notice__sub" style={{ marginTop: 4 }}>
                    This addon predates 1-click web updates, but it's already been
                    auto-checking &amp; silently downloading in the background on its own.
                    Right-click the <strong>Simple tray icon</strong> → if you see
                    “Restart &amp;&amp; Update Now”, click it (no prompts). Otherwise click
                    “Check for Updates” and try again in ~10s. After this one time,
                    updates happen right from this button.
                  </span>
                )}
                {addonPromptOutdated && updateNow.state === 'updating' && (
                  <span className="sidebar__addon-notice__sub" style={{ marginTop: 4 }}>
                    The addon will restart automatically once installed.
                  </span>
                )}
              </div>
              <div className="sidebar__addon-notice__actions">
                {addonPromptOutdated && updateNow.state === 'unsupported' ? (
                  <button
                    className="sidebar__addon-notice__btn"
                    onClick={handleUpdateNow}
                    title="Re-check now that the addon may have finished downloading in the background"
                  >
                    Retry
                  </button>
                ) : addonPromptOutdated ? (
                  <button
                    className="sidebar__addon-notice__btn"
                    onClick={handleUpdateNow}
                    disabled={updateNow.state === 'updating'}
                    title={updateNow.state === 'error' ? updateNow.error : 'Download and install the update, then relaunch the addon'}
                  >
                    {updateNow.state === 'updating'
                      ? (updateNow.progress > 0 ? `Updating… ${updateNow.progress}%` : 'Updating…')
                      : updateNow.state === 'error' ? 'Retry' : 'Update'}
                  </button>
                ) : (
                  <a
                    className="sidebar__addon-notice__btn"
                    href={ADDON_DOWNLOAD_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Get
                  </a>
                )}
                <button
                  className="sidebar__addon-notice__recheck"
                  onClick={onAddonRecheck}
                  disabled={addonPromptChecking}
                  title="Recheck addon status"
                >
                  {addonPromptChecking ? '…' : '↺'}
                </button>
                <button
                  className="sidebar__addon-notice__dismiss"
                  onClick={onAddonDismiss}
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          <button
            className="sidebar__settings-toggle"
            onClick={() => toggleSection('settings')}
            aria-expanded={openSection === 'settings'}
            aria-controls="sidebar-settings-panel"
          >
            ⚙ Settings
            <span className={`sidebar__arrow ${openSection === 'settings' ? 'sidebar__arrow--up' : ''}`}>▾</span>
          </button>

          {openSection === 'settings' && (
            <div className="sidebar__settings" id="sidebar-settings-panel">
              <div className="sidebar__setting-group">
                <label className="sidebar__label">Agent</label>
                <select
                  className="sidebar__select"
                  value={selectedAgentId}
                  onChange={e => onSettingsChange({ ...settings, selectedAgentId: e.target.value })}
                >
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div className="sidebar__setting-group">
                <label className="sidebar__label">LLM Provider</label>
                <select
                  className="sidebar__select"
                  value={settings?.llmProvider || 'portfolio'}
                  onChange={e => onSettingsChange({ ...settings, llmProvider: e.target.value })}
                >
                  <option value="portfolio">☁️ Cloud ({cloudProviderSummary(portfolioLLMProviders)})</option>
                  {isAddonConnected && <option value="local">💻 {providerLabel(DEFAULT_LOCAL_PROVIDER)}</option>}
                </select>
              </div>

              <div className="sidebar__setting-group">
                <label className="sidebar__label">
                  Model
                  {isPortfolio && <span style={{ fontSize: '10px', color: 'var(--accent)', marginLeft: '4px' }}>☁️ Cloud</span>}
                  {!isPortfolio && <span style={{ fontSize: '10px', color: 'var(--accent)', marginLeft: '4px' }}>💻 Local</span>}
                </label>
                {isPortfolio ? (
                  // EVERY cloud model the server has configured, not just the one
                  // currently selected — this used to be static text showing the
                  // resolved model, so DeepSeek was configurable server-side and
                  // invisible here. `CloudModelSelect` is the shared picker.
                  <CloudModelSelect
                    id="sidebar-model"
                    className="sidebar__select"
                    providers={portfolioLLMProviders}
                    value={settings?.portfolioModel}
                    chosenModelId={settings?.portfolioModelChosen}
                    onChange={(modelId) => onSettingsChange?.({ ...settings, ...cloudModelChoicePatch(modelId) })}
                  />
                ) : (
                  <select
                    className="sidebar__select"
                    value={selectedModel}
                    onChange={e => onSelectModel(e.target.value)}
                    disabled={!isAddonConnected}
                  >
                    {models.filter(m => m.provider !== 'github').map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name} {m.local ? '(local)' : ''}
                      </option>
                    ))}
                    {models.length === 0 && (
                      <option disabled>No local models (addon required)</option>
                    )}
                  </select>
                )}
              </div>

              <button
                className="sidebar__advanced-btn"
                onClick={() => onOpenAdvancedSettings()}
              >
                🔧 Advanced Settings
              </button>
            </div>
          )}

          <button
            className="sidebar__settings-toggle"
            onClick={() => toggleSection('liveAgent')}
            aria-expanded={openSection === 'liveAgent'}
            aria-controls="sidebar-live-agent-panel"
          >
            ⚡ Macros & Loop
            <span className={`sidebar__arrow ${openSection === 'liveAgent' ? 'sidebar__arrow--up' : ''}`}>▾</span>
          </button>

          {openSection === 'liveAgent' && (
            <div className="sidebar__live-agent" id="sidebar-live-agent-panel">
              <AgentLivePanel
                addonConnected={isAddonConnected}
                user={user}
                onManageMacros={() => onOpenAdvancedSettings('shortcuts')}
                variant="sidebar"
              />
            </div>
          )}
        </div>
          {isAddonConnected && !showAddonPrompt && (
            <div
              className={`sidebar__addon-connected sidebar__addon-connected--${addonTest.state}`}
              onClick={runAddonTest}
              role="button"
              tabIndex={0}
              title="Click to run addon diagnostics"
            >
              <span className="sidebar__addon-connected__icon">
                {addonTest.state === 'testing' ? '⏳' : '🧩'}
              </span>
              <span className="sidebar__addon-connected__label">
                {addonTest.state === 'idle' && <>Addon connected{addonCurrentVersion && <span className="sidebar__addon-connected__version"> v{addonCurrentVersion}</span>}</>}
                {addonTest.state === 'testing' && 'Running diagnostics…'}
                {addonTest.state === 'passed' && 'All checks passed'}
                {addonTest.state === 'failed' && 'Some checks failed'}
              </span>
              <span className="sidebar__addon-connected__check">
                {addonTest.state === 'idle' && '✓'}
                {addonTest.state === 'testing' && ''}
                {addonTest.state === 'passed' && '✓'}
                {addonTest.state === 'failed' && '✗'}
              </span>
            </div>
          )}
          {addonTest.checks.length > 0 && (
            <div className="sidebar__addon-test-results">
              {addonTest.checks.map((c, i) => (
                <div key={i} className={`sidebar__addon-test-row ${c.ok ? 'sidebar__addon-test-row--ok' : 'sidebar__addon-test-row--fail'}`}>
                  <span className="sidebar__addon-test-row__icon">{c.ok ? '✓' : '✗'}</span>
                  <span className="sidebar__addon-test-row__name">{c.name}</span>
                  <span className="sidebar__addon-test-row__detail">{c.detail}</span>
                </div>
              ))}
            </div>
          )}
        {SHOW_ACCOUNT_METERS && (
          <>
            <UsageMeter user={user} />
            <StorageMeter user={user} />
          </>
        )}
      </aside>
    </>
  );
}

export default Sidebar;
