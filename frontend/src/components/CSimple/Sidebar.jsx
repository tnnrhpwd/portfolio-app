import React, { useState, useEffect, useCallback } from 'react';
import { getLocalModels, testAddonConnection, runAddonSingleClickUpdate } from '../../services/csimpleApi';
import UsageMeter from './UsageMeter';
import AgentLivePanel from './AgentLivePanel';
import './Sidebar.css';

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
}) {
  const [models, setModels] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showLiveAgent, setShowLiveAgent] = useState(false);
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
  const isGitHub = settings?.llmProvider === 'github';
  const isPortfolio = settings?.llmProvider === 'portfolio';

  // The effective model depends on the provider
  const effectiveModel = isGitHub
    ? (settings?.githubModel || 'gpt-4o-mini')
    : isPortfolio
      ? (settings?.portfolioModel || 'gpt-4o-mini')
      : selectedModel;

  // GitHub Models available client-side (via GitHub PAT / Copilot subscription)
  // All free with Copilot — rate differs: low ≈ 150 req/day, high ≈ 1500 req/day
  const GITHUB_MODELS = [
    // OpenAI
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'github', rate: 'Free · 150/day' },
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'github', rate: 'Free · 50/day' },
    { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'github', rate: 'Free · 50/day' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'github', rate: 'Free · 150/day' },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', provider: 'github', rate: 'Free · 150/day' },
    { id: 'o3-mini', name: 'o3-mini', provider: 'github', rate: 'Free · 50/day' },
    { id: 'o4-mini', name: 'o4-mini', provider: 'github', rate: 'Free · 50/day' },
    // Anthropic Claude
    { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'github', rate: 'Free · 50/day' },
    { id: 'claude-3.5-haiku', name: 'Claude 3.5 Haiku', provider: 'github', rate: 'Free · 150/day' },
    // Meta Llama
    { id: 'Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', provider: 'github', rate: 'Free · 150/day' },
    { id: 'Meta-Llama-3.1-405B-Instruct', name: 'Llama 3.1 405B', provider: 'github', rate: 'Free · 50/day' },
    // Mistral
    { id: 'Mistral-large-2411', name: 'Mistral Large', provider: 'github', rate: 'Free · 50/day' },
    { id: 'Mistral-small', name: 'Mistral Small', provider: 'github', rate: 'Free · 150/day' },
    // DeepSeek
    { id: 'DeepSeek-R1', name: 'DeepSeek R1', provider: 'github', rate: 'Free · 50/day' },
    // Microsoft
    { id: 'Phi-4', name: 'Phi-4', provider: 'github', rate: 'Free · 150/day' },
    // Cohere
    { id: 'Cohere-command-r-plus', name: 'Command R+', provider: 'github', rate: 'Free · 50/day' },
  ];

  // Derive the user's membership tier from the user prop
  const userTier = React.useMemo(() => {
    const text = user?.text || '';
    const match = text.match(/\|Rank:(\w+)/);
    return match ? match[1].toLowerCase() : 'free';
  }, [user?.text]);

  const canAccessTier = (requiredTier) => {
    if (!requiredTier || requiredTier === 'free') return true;
    if (requiredTier === 'pro') return userTier === 'pro' || userTier === 'simple';
    if (requiredTier === 'simple') return userTier === 'simple';
    return true;
  };

  // Build portfolio models list from providers
  // config.models may be an array OR an object keyed by model ID
  const portfolioModels = React.useMemo(() => {
    if (!portfolioLLMProviders) return [];
    const result = [];
    Object.entries(portfolioLLMProviders).forEach(([provider, config]) => {
      if (!config.models) return;
      if (Array.isArray(config.models)) {
        config.models.forEach(m => {
          result.push({
            id: typeof m === 'string' ? m : m.id,
            name: typeof m === 'string' ? m : (m.name || m.id),
            provider,
            rate: (typeof m === 'object' && m.rate) ? m.rate : null,
            requiredTier: (typeof m === 'object' && m.requiredTier) ? m.requiredTier : null,
          });
        });
      } else {
        Object.entries(config.models).forEach(([modelId, modelInfo]) => {
          result.push({
            id: modelId,
            name: (modelInfo && modelInfo.name) ? modelInfo.name : modelId,
            provider,
            rate: modelInfo?.rate || null,
            requiredTier: modelInfo?.requiredTier || null,
          });
        });
      }
    });
    return result;
  }, [portfolioLLMProviders]);

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
          <div className="sidebar__section-title">Conversations</div>
          {conversations.map(conv => (
            <div
              key={conv.id}
              className={`sidebar__conv ${conv.id === activeConversationId ? 'sidebar__conv--active' : ''}`}
              onClick={() => onSelectConversation(conv.id)}
            >
              <span className="sidebar__conv-icon">💬</span>
              <span className="sidebar__conv-title">{conv.title}</span>
              <button
                className="sidebar__conv-delete"
                onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.id); }}
                title="Delete conversation"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar__footer">
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

          {showAddonPrompt && addonNeedsOptIn && (
            <div className="sidebar__addon-notice">
              <span className="sidebar__addon-notice__icon">🔌</span>
              <div className="sidebar__addon-notice__body">
                <span className="sidebar__addon-notice__title">Enable local addon?</span>
                <span className="sidebar__addon-notice__sub">
                  Connects this page to C‑Simple on your computer for local AI
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
                    : 'Start C-Simple to enable local AI & automation'}
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
                    Right-click the <strong>CSimple tray icon</strong> → if you see
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
                    href="https://github.com/tnnrhpwd/portfolio-app/releases"
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
            onClick={() => setShowSettings(!showSettings)}
          >
            ⚙ Settings
            <span className={`sidebar__arrow ${showSettings ? 'sidebar__arrow--up' : ''}`}>▾</span>
          </button>

          {showSettings && (
            <div className="sidebar__settings">
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
                  <option value="portfolio">☁️ Cloud (Portfolio)</option>
                  {isAddonConnected && <option value="local">💻 Local (HuggingFace)</option>}
                  <option value="github">🐙 GitHub Models</option>
                </select>
              </div>

              <div className="sidebar__setting-group">
                <label className="sidebar__label">
                  Model
                  {isGitHub && <span style={{ fontSize: '10px', color: 'var(--accent)', marginLeft: '4px' }}>🐙 GitHub</span>}
                  {isPortfolio && <span style={{ fontSize: '10px', color: 'var(--accent)', marginLeft: '4px' }}>☁️ Cloud</span>}
                  {!isGitHub && !isPortfolio && <span style={{ fontSize: '10px', color: 'var(--accent)', marginLeft: '4px' }}>💻 Local</span>}
                </label>
                {isGitHub ? (
                  <select
                    className="sidebar__select"
                    value={effectiveModel}
                    onChange={e => onSettingsChange({ ...settings, githubModel: e.target.value })}
                  >
                    {GITHUB_MODELS.map(m => (
                      <option key={m.id} value={m.id}>{m.name} — {m.rate || 'Free'}</option>
                    ))}
                  </select>
                ) : isPortfolio ? (
                  <select
                    className="sidebar__select"
                    value={effectiveModel}
                    onChange={e => {
                      const m = portfolioModels.find(pm => pm.id === e.target.value);
                      if (m && !canAccessTier(m.requiredTier)) return;
                      onSettingsChange({ ...settings, portfolioModel: e.target.value });
                    }}
                  >
                    {portfolioModels.length > 0 ? (
                      portfolioModels.map(m => {
                        const locked = !canAccessTier(m.requiredTier);
                        const tierLabel = m.requiredTier === 'simple' ? '🔒 Simple' : m.requiredTier === 'pro' ? '🔒 Pro' : '';
                        return (
                          <option key={m.id} value={m.id} disabled={locked}>
                            {locked ? `${tierLabel} · ` : ''}{m.name} ({m.provider}) — {m.rate || '—'}
                          </option>
                        );
                      })
                    ) : (
                      <>
                        <option value="gpt-4o-mini">gpt-4o-mini</option>
                        <option value="gpt-4o-mini">gpt-4o-mini</option>
                      </>
                    )}
                  </select>
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
                onClick={onOpenAdvancedSettings}
              >
                🔧 Advanced Settings
              </button>
            </div>
          )}

          <button
            className="sidebar__settings-toggle"
            onClick={() => setShowLiveAgent(!showLiveAgent)}
          >
            🖥 Live Agent View
            <span className={`sidebar__arrow ${showLiveAgent ? 'sidebar__arrow--up' : ''}`}>▾</span>
          </button>

          {showLiveAgent && (
            <div className="sidebar__live-agent">
              <AgentLivePanel addonConnected={isAddonConnected} variant="sidebar" />
            </div>
          )}
        </div>

        <UsageMeter user={user} />
      </aside>
    </>
  );
}

export default Sidebar;
