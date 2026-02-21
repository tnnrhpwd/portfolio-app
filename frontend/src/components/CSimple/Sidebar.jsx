import React, { useState, useEffect, useCallback } from 'react';
import { getLocalModels, testAddonConnection } from '../../services/csimpleApi';
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
  showAddonPrompt = false,
  addonPromptOutdated = false,
  addonPromptChecking = false,
  onAddonRecheck,
  onAddonDismiss,
  addonCurrentVersion,
  addonRequiredVersion,
}) {
  const [models, setModels] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [addonTest, setAddonTest] = useState({ state: 'idle', checks: [] });

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

  // GitHub Models available client-side
  const GITHUB_MODELS = [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'github' },
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'github' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'github' },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', provider: 'github' },
  ];

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
          });
        });
      } else {
        Object.entries(config.models).forEach(([modelId, modelInfo]) => {
          result.push({
            id: modelId,
            name: (modelInfo && modelInfo.name) ? modelInfo.name : modelId,
            provider,
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

          {showAddonPrompt && (
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
              </div>
              <div className="sidebar__addon-notice__actions">
                <a
                  className="sidebar__addon-notice__btn"
                  href="https://github.com/tnnrhpwd/portfolio-app/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {addonPromptOutdated ? 'Update' : 'Get'}
                </a>
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
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                ) : isPortfolio ? (
                  <select
                    className="sidebar__select"
                    value={effectiveModel}
                    onChange={e => onSettingsChange({ ...settings, portfolioModel: e.target.value })}
                  >
                    {portfolioModels.length > 0 ? (
                      portfolioModels.map(m => (
                        <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
                      ))
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
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
