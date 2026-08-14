import './AIWorkflowSettings.css';
import { buildCloudModelList, FALLBACK_CLOUD_MODEL, cloudProviderLabel } from '../../utils/llmProviderOptions.js';

/**
 * AIWorkflowSettings — the single source of truth for the AI chat preferences
 * that are shared between the Settings page (`/settings`) and the Net chat's
 * Advanced Settings modal (`/net`). Both surfaces read/write the same
 * `csimple_device_settings` data, so this component owns the fields once
 * instead of each host page re-implementing (and drifting from) its own copy.
 *
 * Addon-only power tools (Agents, Goals, Shortcuts, Workspace, Network/QR
 * pairing, mic device selection) are intentionally NOT part of this shared
 * component — those stay in the Net Advanced Settings modal only.
 *
 * @param {object} props
 * @param {object} props.settings - Current settings object (subset of csimple_device_settings).
 * @param {function} props.onChange - (key, value) => void — called on every field change.
 * @param {object} [props.user] - Logged-in user, used to gate Cloud Sync.
 * @param {string} [props.cloudSyncStatus] - null | 'syncing' | 'synced' | 'error'
 * @param {boolean} [props.sttSupported] - Whether speech recognition is supported in this browser.
 * @param {object} [props.portfolioLLMProviders] - `/llm-providers` response (cloud models actually
 *   configured on the backend — currently AWS Bedrock). Falls back to a single Bedrock entry while
 *   loading so the dropdown never shows retired GitHub Models-era options like GPT-4o.
 */
function AIWorkflowSettings({ settings, onChange, user, cloudSyncStatus, sttSupported = true, portfolioLLMProviders }) {
  const update = (key, value) => onChange?.(key, value);

  const cloudModels = buildCloudModelList(portfolioLLMProviders);
  const modelOptions = cloudModels.length > 0 ? cloudModels : [FALLBACK_CLOUD_MODEL];
  // Older stored settings may still carry a retired GitHub Models-era id
  // (e.g. 'gpt-4o-mini') — fall back to the first live model instead of
  // rendering a <select> whose value matches none of its <option>s.
  const selectedModelId = modelOptions.some(m => m.id === settings.portfolioModel)
    ? settings.portfolioModel
    : modelOptions[0].id;

  return (
    <div className="aiw-root">
      <div className="aiw-grid">
        <div className="aiw-item">
          <label className="aiw-label" htmlFor="aiw-llm-provider">☁️ LLM Provider</label>
          <select
            id="aiw-llm-provider"
            value={settings.llmProvider || 'portfolio'}
            onChange={e => update('llmProvider', e.target.value)}
            className="aiw-input"
          >
            <option value="portfolio">☁️ Cloud (AWS Bedrock)</option>
            <option value="local">💻 Local (HuggingFace)</option>
          </select>
          <span className="aiw-hint">Switch providers depending on where you want responses generated.</span>
        </div>

        <div className="aiw-item">
          <label className="aiw-label" htmlFor="aiw-model">
            🧠 Model
            {(settings.llmProvider === 'portfolio' || !settings.llmProvider) && <span className="aiw-badge">☁️ Cloud</span>}
            {settings.llmProvider === 'local' && <span className="aiw-badge">💻 Local</span>}
          </label>
          {settings.llmProvider === 'local' ? (
            <p className="aiw-note">Local models require the Simple addon to be running.</p>
          ) : (
            <>
              <select
                id="aiw-model"
                value={selectedModelId}
                onChange={e => update('portfolioModel', e.target.value)}
                className="aiw-input"
              >
                {modelOptions.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}{m.rate ? ` — ${m.rate}` : ''}
                  </option>
                ))}
              </select>
              <span className="aiw-hint">
                Served by {cloudProviderLabel(modelOptions[0]?.provider)} — no API key needed, usage is metered against your plan.
              </span>
            </>
          )}
        </div>
      </div>

      <h3 className="aiw-subtitle">💬 Chat preferences</h3>
      <div className="aiw-grid">
        <div className="aiw-item">
          <label className="aiw-label" htmlFor="aiw-temperature">🌡️ Temperature</label>
          <div className="aiw-range-group">
            <input
              id="aiw-temperature"
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={settings.defaultTemperature ?? 0.7}
              onChange={e => update('defaultTemperature', parseFloat(e.target.value))}
              className="aiw-range"
            />
            <span className="aiw-range-value">{(settings.defaultTemperature ?? 0.7).toFixed(1)}</span>
          </div>
          <span className="aiw-hint">Lower = more focused, higher = more creative.</span>
        </div>

        <div className="aiw-item">
          <label className="aiw-label" htmlFor="aiw-max-tokens">📏 Max Tokens</label>
          <input
            id="aiw-max-tokens"
            type="number"
            min="50"
            max="4000"
            step="50"
            value={settings.defaultMaxTokens ?? 500}
            onChange={e => update('defaultMaxTokens', parseInt(e.target.value, 10) || 500)}
            className="aiw-input"
          />
          <span className="aiw-hint">Maximum response length (50-4000).</span>
        </div>

        <div className="aiw-item">
          <label className="aiw-label" htmlFor="aiw-history">🗂️ Conversation History</label>
          <div className="aiw-range-group">
            <input
              id="aiw-history"
              type="range"
              min="5"
              max="100"
              step="5"
              value={settings.maxConversationHistory ?? 20}
              onChange={e => update('maxConversationHistory', parseInt(e.target.value, 10))}
              className="aiw-range"
            />
            <span className="aiw-range-value">{settings.maxConversationHistory ?? 20}</span>
          </div>
          <span className="aiw-hint">Messages of context sent with each request.</span>
        </div>
      </div>

      <div className="aiw-toggle-grid">
        <label className="aiw-toggle-card">
          <div className="aiw-toggle-copy">
            <span className="aiw-toggle-title">⏎ Send with Enter</span>
            <span className="aiw-toggle-description">Press Enter to send and Shift+Enter for a new line.</span>
          </div>
          <input
            type="checkbox"
            checked={settings.sendWithEnter ?? true}
            onChange={e => update('sendWithEnter', e.target.checked)}
            className="aiw-checkbox"
          />
        </label>

        <label className="aiw-toggle-card">
          <div className="aiw-toggle-copy">
            <span className="aiw-toggle-title">🕐 Show Timestamps</span>
            <span className="aiw-toggle-description">Display sent times in chat conversations.</span>
          </div>
          <input
            type="checkbox"
            checked={settings.showTimestamps ?? true}
            onChange={e => update('showTimestamps', e.target.checked)}
            className="aiw-checkbox"
          />
        </label>

        <label className="aiw-toggle-card">
          <div className="aiw-toggle-copy">
            <span className="aiw-toggle-title">📝 Markdown Rendering</span>
            <span className="aiw-toggle-description">Render structured AI answers with formatting and code blocks.</span>
          </div>
          <input
            type="checkbox"
            checked={settings.enableMarkdown ?? true}
            onChange={e => update('enableMarkdown', e.target.checked)}
            className="aiw-checkbox"
          />
        </label>

        <label className="aiw-toggle-card">
          <div className="aiw-toggle-copy">
            <span className="aiw-toggle-title">💾 Save Chats Locally</span>
            <span className="aiw-toggle-description">Store conversation history in this browser.</span>
          </div>
          <input
            type="checkbox"
            checked={settings.saveChatsLocally ?? true}
            onChange={e => update('saveChatsLocally', e.target.checked)}
            className="aiw-checkbox"
          />
        </label>

        <label className="aiw-toggle-card">
          <div className="aiw-toggle-copy">
            <span className="aiw-toggle-title">☁️ Cloud Sync</span>
            <span className="aiw-toggle-description">
              {user ? 'Sync chats and settings across your devices.' : 'Log in to enable cloud sync.'}
              {cloudSyncStatus && settings.cloudSync && user && (
                <>
                  {' '}
                  {cloudSyncStatus === 'syncing' && '⟳ Syncing...'}
                  {cloudSyncStatus === 'synced' && '✓ Synced'}
                  {cloudSyncStatus === 'error' && '✗ Sync failed'}
                </>
              )}
            </span>
          </div>
          <input
            type="checkbox"
            checked={settings.cloudSync ?? false}
            onChange={e => update('cloudSync', e.target.checked)}
            disabled={!user}
            className="aiw-checkbox"
          />
        </label>

        <label className="aiw-toggle-card">
          <div className="aiw-toggle-copy">
            <span className="aiw-toggle-title">🔊 Text-to-Speech</span>
            <span className="aiw-toggle-description">Speak AI responses and action descriptions aloud.</span>
          </div>
          <input
            type="checkbox"
            checked={settings.ttsEnabled ?? true}
            onChange={e => update('ttsEnabled', e.target.checked)}
            className="aiw-checkbox"
          />
        </label>

        <label className="aiw-toggle-card">
          <div className="aiw-toggle-copy">
            <span className="aiw-toggle-title">🎤 Speech Recognition</span>
            <span className="aiw-toggle-description">
              {sttSupported ? 'Enable voice commands and wake-word listening.' : 'Not supported in this browser.'}
            </span>
          </div>
          <input
            type="checkbox"
            checked={settings.sttEnabled ?? false}
            onChange={e => update('sttEnabled', e.target.checked)}
            disabled={!sttSupported}
            className="aiw-checkbox"
          />
        </label>
      </div>
    </div>
  );
}

export default AIWorkflowSettings;
