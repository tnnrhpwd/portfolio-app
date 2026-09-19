import './AIWorkflowSettings.css';
import { cloudModelChoicePatch, cloudProviderSummary } from '../../utils/llmProviderOptions.js';
import { DEFAULT_LOCAL_PROVIDER, providerLabel } from '../../constants/aiModel.js';
import CloudModelSelect from './CloudModelSelect';

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
 * Cloud mode delegates model choice to the backend's configured cloud
 * providers (AWS Bedrock by default, plus DeepSeek when configured), so the
 * model picker below lists whatever the live `/llm-providers` response
 * reports. The temperature/tokens/history controls are only rendered once
 * the user switches the LLM Provider to Local.
 *
 * @param {object} props
 * @param {object} props.settings - Current settings object (subset of csimple_device_settings).
 * @param {function} props.onChange - (key, value) => void — called on every field change.
 * @param {object} [props.user] - Logged-in user, used to gate Cloud Sync.
 * @param {string} [props.cloudSyncStatus] - null | 'syncing' | 'synced' | 'trimmed' | 'error'
 * @param {boolean} [props.sttSupported] - Whether speech recognition is supported in this browser.
 */
function AIWorkflowSettings({ settings, onChange, user, cloudSyncStatus, sttSupported = true, portfolioLLMProviders }) {
  // `onChange` takes either a single field or a PATCH object. The model picker
  // uses the patch form: choosing a model writes the id and the record of the
  // choice together (`cloudModelChoicePatch`), and two sequential calls would
  // race on the host's stale settings snapshot.
  const update = (keyOrPatch, value) => onChange?.(keyOrPatch, value);

  const isLocal = settings.llmProvider === 'local';

  return (
    <div className="aiw-root">
      <div className="aiw-grid">
        <div className={isLocal ? 'aiw-item' : 'aiw-item aiw-item-full'}>
          <label className="aiw-label" htmlFor="aiw-llm-provider">☁️ LLM Provider</label>
          <select
            id="aiw-llm-provider"
            value={settings.llmProvider || 'portfolio'}
            onChange={e => update('llmProvider', e.target.value)}
            className="aiw-input"
          >
            <option value="portfolio">☁️ Cloud ({cloudProviderSummary(portfolioLLMProviders)})</option>
            <option value="local">💻 {providerLabel(DEFAULT_LOCAL_PROVIDER)}</option>
          </select>
          <span className="aiw-hint">Switch providers depending on where you want responses generated.</span>
        </div>

        {/* Cloud mode lists every model the backend reports as available (AWS
            Bedrock by default, plus DeepSeek when configured) — the SAME
            component the /net sidebar renders, so the two surfaces cannot
            offer different models. Local mode delegates model choice to the
            addon, so the temperature/token/history controls below are only
            shown once the user switches to Local. */}
        {isLocal ? (
          <div className="aiw-item">
            <label className="aiw-label" htmlFor="aiw-model">
              🧠 Model
              <span className="aiw-badge">💻 Local</span>
            </label>
            <p className="aiw-note">Local models require the Simple addon to be running. Pick a model from the addon's sidebar once connected.</p>
          </div>
        ) : (
          <div className="aiw-item">
            <label className="aiw-label" htmlFor="aiw-model">
              🧠 Model
              <span className="aiw-badge">☁️ Cloud</span>
            </label>
            <CloudModelSelect
              id="aiw-model"
              className="aiw-input"
              providers={portfolioLLMProviders}
              value={settings.portfolioModel}
              chosenModelId={settings.portfolioModelChosen}
              onChange={(modelId) => onChange?.(cloudModelChoicePatch(modelId))}
            />
            <span className="aiw-hint">Cloud model used for responses.</span>
          </div>
        )}
      </div>

      {isLocal && (
        <>
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
        </>
      )}

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
                  {/* The conversations synced but WITHOUT the agent step detail, because
                      the payload hit the store's size limit (conversationWeight.js).
                      Saying "✓ Synced" here would be a lie the user only discovers on
                      their other device. */}
                  {cloudSyncStatus === 'trimmed' && (
                    <span title="Your chat history is large, so the agent step detail is not included in the synced copy. The conversations themselves are fully synced.">
                      ✓ Synced (steps trimmed)
                    </span>
                  )}
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
              {sttSupported
                ? 'Enable voice commands and wake-word listening. Turning this on lets the browser ask for microphone access.'
                : 'Not supported in this browser.'}
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
