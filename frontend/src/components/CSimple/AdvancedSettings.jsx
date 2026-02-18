import React, { useState, useEffect, useRef, useCallback } from 'react';
import { categorizeVoices } from '../../hooks/csimple/useSpeech';
import './AdvancedSettings.css';

const TABS = [
  { id: 'general', label: '⚙ General' },
  { id: 'agents', label: '🤖 Agents' },
  { id: 'network', label: '🌐 Network' },
];

function AdvancedSettings({ isOpen, onClose, settings, onSettingsChange, isOnline, speech, micDevices, user, cloudSyncStatus }) {
  const [activeTab, setActiveTab] = useState('general');
  const [behaviors, setBehaviors] = useState([]);
  const [memoryFiles, setMemoryFiles] = useState([]);
  const [personalityFiles, setPersonalityFiles] = useState([]);
  const [editingAgentId, setEditingAgentId] = useState(null);
  const [agentName, setAgentName] = useState('');
  const [networkInfo, setNetworkInfo] = useState(null);
  const [pronTest, setPronTest] = useState({ active: false, agentId: null, heard: [], status: '' });
  const pronRecogRef = useRef(null);
  const [fileEditor, setFileEditor] = useState({ isOpen: false, type: '', filename: '', content: '', isNew: false });
  const [showBehaviors, setShowBehaviors] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showPersonality, setShowPersonality] = useState(false);
  const fileInputRef = useRef(null);
  const autoSaveTimer = useRef(null);

  // Load behaviors and memory files
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/behaviors')
      .then(r => r.json())
      .then(data => setBehaviors(data.behaviors || []))
      .catch(() => {});

    fetch('/api/memory')
      .then(r => r.json())
      .then(data => setMemoryFiles(data.files || []))
      .catch(() => {});

    fetch('/api/personality')
      .then(r => r.json())
      .then(data => setPersonalityFiles(data.files || []))
      .catch(() => {});

    fetch('/api/network')
      .then(r => r.json())
      .then(data => setNetworkInfo(data))
      .catch(() => {});
  }, [isOpen]);

  // Auto-save settings when they change
  const autoSave = useCallback((newSettings) => {
    onSettingsChange(newSettings);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      }).catch(() => {});
    }, 500);
  }, [onSettingsChange]);

  const updateSetting = useCallback((key, value) => {
    const DEVICE_LOCAL_KEYS = ['micDeviceId', 'sttEnabled'];
    const newSettings = { ...settings, [key]: value };
    if (DEVICE_LOCAL_KEYS.includes(key)) {
      // Per-device settings: save to localStorage only, don't sync to server
      try {
        const saved = localStorage.getItem('csimple_device_settings');
        const deviceSettings = saved ? JSON.parse(saved) : {};
        deviceSettings[key] = value;
        localStorage.setItem('csimple_device_settings', JSON.stringify(deviceSettings));
      } catch (e) {
        console.warn('[Settings] Failed to save device-local setting:', e);
      }
      // Still update React state so the UI reflects the change
      onSettingsChange(newSettings);
    } else {
      autoSave(newSettings);
    }
  }, [settings, autoSave, onSettingsChange]);

  // Agent management
  const addAgent = useCallback(() => {
    const newAgent = {
      id: Date.now().toString(),
      name: 'New Agent',
      avatarUrl: null,
      behaviorFile: 'default.txt',
      isDefault: false,
    };
    const newSettings = {
      ...settings,
      agents: [...(settings.agents || []), newAgent],
    };
    autoSave(newSettings);
    setEditingAgentId(newAgent.id);
    setAgentName(newAgent.name);
  }, [settings, autoSave]);

  const updateAgent = useCallback((agentId, updates) => {
    const newAgents = (settings.agents || []).map(a =>
      a.id === agentId ? { ...a, ...updates } : a
    );
    const newSettings = { ...settings, agents: newAgents };
    autoSave(newSettings);
  }, [settings, autoSave]);

  const deleteAgent = useCallback((agentId) => {
    const agent = (settings.agents || []).find(a => a.id === agentId);
    if (agent?.isDefault) return; // Can't delete default
    const newAgents = (settings.agents || []).filter(a => a.id !== agentId);
    const newSettings = {
      ...settings,
      agents: newAgents,
      selectedAgentId: settings.selectedAgentId === agentId
        ? (newAgents[0]?.id || 'default')
        : settings.selectedAgentId,
    };
    autoSave(newSettings);
    if (editingAgentId === agentId) setEditingAgentId(null);
  }, [settings, autoSave, editingAgentId]);

  const handleAvatarUpload = useCallback(async (agentId, file) => {
    const formData = new FormData();
    formData.append('avatar', file);
    try {
      const res = await fetch(`/api/agents/${agentId}/avatar`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.avatarUrl) {
        updateAgent(agentId, { avatarUrl: `${data.avatarUrl}?t=${Date.now()}` });
      }
    } catch (err) {
      console.error('Avatar upload failed:', err);
    }
  }, [updateAgent]);

  const startEditAgent = useCallback((agent) => {
    setEditingAgentId(agent.id);
    setAgentName(agent.name);
  }, []);

  const saveAgentName = useCallback(() => {
    if (editingAgentId && agentName.trim()) {
      updateAgent(editingAgentId, { name: agentName.trim() });
    }
    setEditingAgentId(null);
  }, [editingAgentId, agentName, updateAgent]);

  // ─── Pronunciation Test ────────────────────────────────────────────────
  const startPronTest = useCallback((agentId, name) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setPronTest({ active: false, agentId, heard: [], status: 'Speech recognition not supported in this browser.' });
      return;
    }
    // Stop any existing test
    if (pronRecogRef.current) { try { pronRecogRef.current.abort(); } catch {} }

    // Stop passive and active listening first — browser only allows one session at a time
    if (speech?.isPassiveListening) speech.stopPassiveListening();
    if (speech?.isListening) speech.stopListening();

    // Brief delay so the browser fully releases the previous session
    setTimeout(() => {
      const recog = new SR();
      recog.continuous = false;
      recog.interimResults = false;
      recog.lang = 'en-US';
      recog.maxAlternatives = 5;
      pronRecogRef.current = recog;
      setPronTest({ active: true, agentId, heard: [], status: `Say "${name}" now...` });

      recog.onresult = (event) => {
        const alts = [];
        for (let i = 0; i < event.results[0].length; i++) {
          alts.push({
            text: event.results[0][i].transcript.trim(),
            confidence: Math.round(event.results[0][i].confidence * 100),
          });
        }
        const topWord = alts[0]?.text?.toLowerCase().replace(/[.!?,;:]+$/, '') || '';
        const nameNorm = name.toLowerCase().trim();
        const match = topWord === nameNorm || alts.some(a => a.text.toLowerCase().replace(/[.!?,;:]+$/, '') === nameNorm);
        setPronTest({
          active: false, agentId, heard: alts,
          status: match
            ? `✅ Perfect match! The browser hears "${name}" correctly.`
            : `The browser heard: "${alts[0]?.text}". You can add it as an alias below.`,
        });
      };
      recog.onerror = (event) => {
        setPronTest({ active: false, agentId, heard: [], status: `Error: ${event.error}. Try clicking the button again.` });
      };
      recog.onend = () => {
        pronRecogRef.current = null;
        setPronTest(prev => prev.active ? { ...prev, active: false, status: prev.status || 'No speech detected. Try again.' } : prev);
        // Restart passive listening if STT is enabled (reuses original callback)
        if (settings?.sttEnabled && speech?.resumePassiveListening) {
          setTimeout(() => {
            speech.resumePassiveListening();
          }, 500);
        }
      };
      try { recog.start(); } catch (e) {
        setPronTest({ active: false, agentId, heard: [], status: `Failed to start: ${e.message}` });
      }
    }, 300);
  }, [speech, settings]);

  const addAlias = useCallback((agentId, alias) => {
    const agent = (settings.agents || []).find(a => a.id === agentId);
    if (!agent) return;
    const existing = agent.wakeWordAliases || [];
    const norm = alias.toLowerCase().replace(/[.!?,;:]+$/, '').trim();
    if (!norm || existing.some(e => e.toLowerCase() === norm)) return;
    updateAgent(agentId, { wakeWordAliases: [...existing, norm] });
  }, [settings, updateAgent]);

  const removeAlias = useCallback((agentId, alias) => {
    const agent = (settings.agents || []).find(a => a.id === agentId);
    if (!agent) return;
    updateAgent(agentId, { wakeWordAliases: (agent.wakeWordAliases || []).filter(a => a !== alias) });
  }, [settings, updateAgent]);

  // ─── File Editor Functions ─────────────────────────────────────────────────

  const openFileEditor = useCallback((type, filename = '', content = '', isNew = false) => {
    setFileEditor({ isOpen: true, type, filename, content, isNew });
  }, []);

  const closeFileEditor = useCallback(() => {
    setFileEditor({ isOpen: false, type: '', filename: '', content: '', isNew: false });
  }, []);

  const saveFile = useCallback(async () => {
    const { type, filename, content, isNew } = fileEditor;
    if (!filename || !content) return;

    const endpoint = type === 'behavior' ? '/api/behaviors' : type === 'personality' ? '/api/personality' : '/api/memory';
    try {
      if (isNew) {
        // Create new file
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, content }),
        });
        if (!res.ok) throw new Error('Failed to create file');
      } else {
        // Update existing file
        const res = await fetch(`${endpoint}/${encodeURIComponent(filename)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        if (!res.ok) throw new Error('Failed to update file');
      }

      // Reload the file list
      if (type === 'behavior') {
        const res = await fetch('/api/behaviors');
        const data = await res.json();
        setBehaviors(data.behaviors || []);
      } else if (type === 'personality') {
        const res = await fetch('/api/personality');
        const data = await res.json();
        setPersonalityFiles(data.files || []);
      } else {
        const res = await fetch('/api/memory');
        const data = await res.json();
        setMemoryFiles(data.files || []);
      }

      closeFileEditor();
    } catch (err) {
      console.error('File save error:', err);
      alert(`Failed to save file: ${err.message}`);
    }
  }, [fileEditor, closeFileEditor]);

  const deleteFile = useCallback(async (type, filename) => {
    if (!window.confirm(`Delete ${filename}?`)) return;

    const endpoint = type === 'behavior' ? '/api/behaviors' : type === 'personality' ? '/api/personality' : '/api/memory';
    try {
      const res = await fetch(`${endpoint}/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete file');

      // Reload the file list
      if (type === 'behavior') {
        const res = await fetch('/api/behaviors');
        const data = await res.json();
        setBehaviors(data.behaviors || []);
      } else if (type === 'personality') {
        const res = await fetch('/api/personality');
        const data = await res.json();
        setPersonalityFiles(data.files || []);
      } else {
        const res = await fetch('/api/memory');
        const data = await res.json();
        setMemoryFiles(data.files || []);
      }
    } catch (err) {
      console.error('File delete error:', err);
      alert(`Failed to delete file: ${err.message}`);
    }
  }, []);

  const editFile = useCallback(async (type, filename) => {
    const endpoint = type === 'behavior' ? '/api/behaviors' : type === 'personality' ? '/api/personality' : '/api/memory';
    try {
      const res = await fetch(`${endpoint}/${encodeURIComponent(filename)}`);
      const data = await res.json();
      openFileEditor(type, filename, data.content, false);
    } catch (err) {
      console.error('File read error:', err);
      alert(`Failed to load file: ${err.message}`);
    }
  }, [openFileEditor]);

  if (!isOpen) return null;

  const agents = settings.agents || [];

  return (
    <div className="adv-overlay" onClick={onClose}>
      <div className="adv-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="adv-header">
          <h2 className="adv-header__title">Advanced Settings</h2>
          <button className="adv-header__close" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className="adv-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`adv-tabs__tab ${activeTab === tab.id ? 'adv-tabs__tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="adv-content">
          {/* ─── General Tab ──────────────────────────────────────── */}
          {activeTab === 'general' && (
            <div className="adv-section">
              <div className="adv-group">
                <div className="adv-group__row">
                  <div>
                    <label className="adv-group__label">Save Chats Locally</label>
                    <p className="adv-group__desc">Store conversation history in your browser</p>
                  </div>
                  <label className="adv-toggle">
                    <input
                      type="checkbox"
                      checked={settings.saveChatsLocally ?? true}
                      onChange={e => updateSetting('saveChatsLocally', e.target.checked)}
                    />
                    <span className="adv-toggle__slider" />
                  </label>
                </div>
              </div>

              <div className="adv-group">
                <div className="adv-group__row">
                  <div>
                    <label className="adv-group__label">Cloud Sync</label>
                    <p className="adv-group__desc">
                      {user
                        ? 'Sync settings and conversations across devices'
                        : 'Log in to enable cloud sync'}
                    </p>
                    {cloudSyncStatus && settings.cloudSync && user && (
                      <p className="adv-group__desc" style={{ marginTop: '4px', fontSize: '11px' }}>
                        {cloudSyncStatus === 'syncing' && '⟳ Syncing...'}
                        {cloudSyncStatus === 'synced' && '✓ Synced'}
                        {cloudSyncStatus === 'error' && '✗ Sync failed'}
                      </p>
                    )}
                  </div>
                  <label className="adv-toggle">
                    <input
                      type="checkbox"
                      checked={settings.cloudSync ?? false}
                      onChange={e => updateSetting('cloudSync', e.target.checked)}
                      disabled={!user}
                    />
                    <span className="adv-toggle__slider" />
                  </label>
                </div>
              </div>

              <div className="adv-group">
                <div className="adv-group__row">
                  <div>
                    <label className="adv-group__label">Theme</label>
                    <p className="adv-group__desc">Application color scheme</p>
                  </div>
                  <select
                    className="adv-select"
                    value={settings.theme || 'dark'}
                    onChange={e => updateSetting('theme', e.target.value)}
                  >
                    <option value="dark">🌑 Dark</option>
                    <option value="light">☀️ Light</option>
                    <option value="system">💻 System</option>
                    <option value="crimson">❤️ Crimson</option>
                    <option value="emerald">💎 Emerald</option>
                    <option value="sakura">🌸 Sakura</option>
                    <option value="midnight">🌃 Midnight Blue</option>
                    <option value="sunset">🌅 Sunset</option>
                    <option value="ocean">🌊 Ocean</option>
                    <option value="usa">🇺🇸 USA</option>
                    <option value="cyberpunk">🔮 Cyberpunk</option>
                    <option value="forest">🌲 Forest</option>
                    <option value="monokai">🖥️ Monokai</option>
                  </select>
                </div>
              </div>

              <div className="adv-group">
                <div className="adv-group__row">
                  <div>
                    <label className="adv-group__label">Font Size</label>
                    <p className="adv-group__desc">Text size for messages</p>
                  </div>
                  <select
                    className="adv-select"
                    value={settings.fontSize || 'medium'}
                    onChange={e => updateSetting('fontSize', e.target.value)}
                  >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </div>
              </div>

              <div className="adv-group">
                <div className="adv-group__row">
                  <div>
                    <label className="adv-group__label">Send with Enter</label>
                    <p className="adv-group__desc">Press Enter to send messages (Shift+Enter for newline)</p>
                  </div>
                  <label className="adv-toggle">
                    <input
                      type="checkbox"
                      checked={settings.sendWithEnter ?? true}
                      onChange={e => updateSetting('sendWithEnter', e.target.checked)}
                    />
                    <span className="adv-toggle__slider" />
                  </label>
                </div>
              </div>

              <div className="adv-group">
                <div className="adv-group__row">
                  <div>
                    <label className="adv-group__label">Show Timestamps</label>
                    <p className="adv-group__desc">Display time next to each message</p>
                  </div>
                  <label className="adv-toggle">
                    <input
                      type="checkbox"
                      checked={settings.showTimestamps ?? true}
                      onChange={e => updateSetting('showTimestamps', e.target.checked)}
                    />
                    <span className="adv-toggle__slider" />
                  </label>
                </div>
              </div>

              <div className="adv-group">
                <div className="adv-group__row">
                  <div>
                    <label className="adv-group__label">Enable Markdown</label>
                    <p className="adv-group__desc">Render markdown formatting in AI responses</p>
                  </div>
                  <label className="adv-toggle">
                    <input
                      type="checkbox"
                      checked={settings.enableMarkdown ?? true}
                      onChange={e => updateSetting('enableMarkdown', e.target.checked)}
                    />
                    <span className="adv-toggle__slider" />
                  </label>
                </div>
              </div>

              <div className="adv-group">
                <label className="adv-group__label">Default Temperature</label>
                <p className="adv-group__desc">Controls randomness in AI responses (0 = deterministic, 1 = creative)</p>
                <div className="adv-group__slider-row">
                  <input
                    type="range"
                    className="adv-range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={settings.defaultTemperature ?? 0.7}
                    onChange={e => updateSetting('defaultTemperature', parseFloat(e.target.value))}
                  />
                  <span className="adv-group__slider-value">{(settings.defaultTemperature ?? 0.7).toFixed(1)}</span>
                </div>
              </div>

              <div className="adv-group">
                <label className="adv-group__label">Default Max Tokens</label>
                <p className="adv-group__desc">Maximum length of AI responses</p>
                <div className="adv-group__slider-row">
                  <input
                    type="range"
                    className="adv-range"
                    min="50"
                    max="2000"
                    step="50"
                    value={settings.defaultMaxTokens ?? 500}
                    onChange={e => updateSetting('defaultMaxTokens', parseInt(e.target.value))}
                  />
                  <span className="adv-group__slider-value">{settings.defaultMaxTokens ?? 500}</span>
                </div>
              </div>

              <div className="adv-group">
                <label className="adv-group__label">Max Conversation History</label>
                <p className="adv-group__desc">Number of messages to include as context</p>
                <div className="adv-group__slider-row">
                  <input
                    type="range"
                    className="adv-range"
                    min="5"
                    max="100"
                    step="5"
                    value={settings.maxConversationHistory ?? 50}
                    onChange={e => updateSetting('maxConversationHistory', parseInt(e.target.value))}
                  />
                  <span className="adv-group__slider-value">{settings.maxConversationHistory ?? 50}</span>
                </div>
              </div>

              {/* ─── LLM Provider ─────────────────────── */}
              <h3 className="adv-section__subtitle">🧠 LLM Provider</h3>

              <div className="adv-group">
                <label className="adv-group__label">Provider</label>
                <p className="adv-group__desc">Choose between local models (slow, private) or GitHub Models API (fast, requires token)</p>
                <div className="adv-group__row" style={{ gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    className={`adv-pill ${(settings.llmProvider || 'local') === 'local' ? 'adv-pill--active' : ''}`}
                    onClick={() => updateSetting('llmProvider', 'local')}
                  >
                    💻 Local (HuggingFace)
                  </button>
                  <button
                    className={`adv-pill ${settings.llmProvider === 'github' ? 'adv-pill--active' : ''}`}
                    onClick={() => updateSetting('llmProvider', 'github')}
                  >
                    🐙 GitHub Models
                  </button>
                </div>
              </div>

              {settings.llmProvider === 'github' && (
                <>
                  <div className="adv-group">
                    <label className="adv-group__label">GitHub Personal Access Token</label>
                    <p className="adv-group__desc">
                      Create a <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" className="adv-link-inline">classic PAT</a> (not fine-grained) — no scopes needed.
                      Requires a <a href="https://github.com/features/copilot" target="_blank" rel="noreferrer" className="adv-link-inline">GitHub Copilot</a> subscription.
                    </p>
                    <div className="adv-group__row" style={{ gap: '8px' }}>
                      <input
                        type="password"
                        className="adv-input"
                        placeholder="ghp_..."
                        value={settings.githubToken || ''}
                        onChange={e => updateSetting('githubToken', e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <span style={{ fontSize: '12px', color: settings.githubToken ? (settings.githubToken.startsWith('ghp_') ? 'var(--success, #22c55e)' : '#f59e0b') : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {settings.githubToken
                          ? (settings.githubToken.startsWith('ghp_') ? '✓ Classic PAT' : '⚠ Use a classic PAT (ghp_...)')
                          : '✗ Not set'}
                      </span>
                    </div>
                  </div>

                  <div className="adv-group">
                    <label className="adv-group__label">GitHub Model</label>
                    <p className="adv-group__desc">Select which model to use via GitHub Models API</p>
                    <select
                      className="adv-select"
                      value={settings.githubModel || 'gpt-4o-mini'}
                      onChange={e => updateSetting('githubModel', e.target.value)}
                    >
                      <option value="gpt-4o-mini">GPT-4o Mini — fast &amp; cheap</option>
                      <option value="gpt-4o">GPT-4o — most capable</option>
                      <option value="gpt-4.1-mini">GPT-4.1 Mini — balanced</option>
                      <option value="gpt-4.1-nano">GPT-4.1 Nano — fastest</option>
                    </select>
                  </div>
                </>
              )}

              {/* ─── Voice & Speech ─────────────────────── */}
              <h3 className="adv-section__subtitle">🎙 Voice &amp; Speech</h3>

              <div className="adv-group">
                <label className="adv-group__label">Text-to-Speech</label>
                <p className="adv-group__desc">Speak action descriptions aloud when executing commands</p>
                <label className="adv-toggle">
                  <input
                    type="checkbox"
                    checked={settings.ttsEnabled ?? true}
                    onChange={e => updateSetting('ttsEnabled', e.target.checked)}
                  />
                  <span className="adv-toggle__slider"></span>
                  <span className="adv-toggle__text">{(settings.ttsEnabled ?? true) ? 'Enabled' : 'Disabled'}</span>
                </label>
              </div>

              <div className="adv-group">
                <label className="adv-group__label">Speech Recognition (STT)</label>
                <p className="adv-group__desc">Enable microphone input for voice commands. Say the agent&apos;s name as a wake word.</p>
                <label className="adv-toggle">
                  <input
                    type="checkbox"
                    checked={settings.sttEnabled ?? false}
                    onChange={e => updateSetting('sttEnabled', e.target.checked)}
                    disabled={!speech?.sttSupported}
                  />
                  <span className="adv-toggle__slider"></span>
                  <span className="adv-toggle__text">
                    {!speech?.sttSupported ? 'Not supported in this browser' : (settings.sttEnabled ? 'Enabled' : 'Disabled')}
                  </span>
                </label>
              </div>

              {/* ─── Microphone Selection ─────────────────────── */}
              <div className="adv-group">
                <label className="adv-group__label">Microphone</label>
                <p className="adv-group__desc">
                  Select which microphone to use for voice recognition.
                  {' '}
                  <button
                    className="adv-link-btn"
                    onClick={() => micDevices?.isMetering ? micDevices.stopMetering() : micDevices?.startMetering()}
                    type="button"
                  >
                    {micDevices?.isMetering ? '⏹ Stop testing' : '🎤 Test microphones'}
                  </button>
                  {' · '}
                  <a
                    className="adv-link-btn"
                    href="/mic-test"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    🔍 Diagnostic
                  </a>
                </p>
                <div className="adv-mic-list">
                  {(micDevices?.devices || []).length === 0 && (
                    <p className="adv-mic-list__empty">No microphones detected</p>
                  )}
                  {(micDevices?.devices || []).map(dev => {
                    const isSelected = (settings.micDeviceId || '') === dev.deviceId
                      || (!settings.micDeviceId && dev.deviceId === 'default');
                    const volume = micDevices?.volumes?.[dev.deviceId] ?? 0;
                    const hasError = volume === -1;
                    return (
                      <button
                        key={dev.deviceId}
                        type="button"
                        className={`adv-mic-item ${isSelected ? 'adv-mic-item--selected' : ''}`}
                        onClick={() => updateSetting('micDeviceId', dev.deviceId)}
                      >
                        <span className="adv-mic-item__radio">
                          {isSelected ? '◉' : '○'}
                        </span>
                        <span className="adv-mic-item__label">{dev.label}</span>
                        {micDevices?.isMetering && (
                          <span className="adv-mic-item__meter">
                            {hasError ? (
                              <span className="adv-mic-item__error">✕</span>
                            ) : (
                              <span className="adv-mic-item__bar-wrap">
                                <span
                                  className={`adv-mic-item__bar ${volume > 30 ? 'adv-mic-item__bar--active' : ''} ${volume > 60 ? 'adv-mic-item__bar--loud' : ''}`}
                                  style={{ width: `${volume}%` }}
                                />
                              </span>
                            )}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ─── Agents Tab ───────────────────────────────────────── */}
          {activeTab === 'agents' && (
            <div className="adv-section">
              <p className="adv-section__intro">
                Create and customize AI agents with unique names, avatars, and behavior profiles.
                Each agent uses a behavior file as its system prompt.
              </p>

              <div className="adv-agents">
                {agents.map(agent => (
                  <div key={agent.id} className={`adv-agent ${settings.selectedAgentId === agent.id ? 'adv-agent--selected' : ''}`}>
                    <div className="adv-agent__header">
                      {/* Avatar */}
                      <div
                        className="adv-agent__avatar"
                        onClick={() => {
                          fileInputRef.current?.setAttribute('data-agent-id', agent.id);
                          fileInputRef.current?.click();
                        }}
                        title="Click to upload avatar"
                      >
                        {agent.avatarUrl ? (
                          <img src={agent.avatarUrl} alt={agent.name} className="adv-agent__avatar-img" />
                        ) : (
                          <span className="adv-agent__avatar-placeholder">
                            {agent.name?.charAt(0)?.toUpperCase() || 'C'}
                          </span>
                        )}
                        <div className="adv-agent__avatar-overlay">📷</div>
                      </div>

                      {/* Name */}
                      <div className="adv-agent__info">
                        {editingAgentId === agent.id ? (
                          <input
                            className="adv-agent__name-input"
                            value={agentName}
                            onChange={e => setAgentName(e.target.value)}
                            onBlur={saveAgentName}
                            onKeyDown={e => e.key === 'Enter' && saveAgentName()}
                            autoFocus
                          />
                        ) : (
                          <span
                            className="adv-agent__name"
                            onClick={() => !agent.isDefault || true ? startEditAgent(agent) : null}
                          >
                            {agent.name}
                            {agent.isDefault && <span className="adv-agent__badge">Default</span>}
                          </span>
                        )}

                        {/* Pronunciation test */}
                        <div className="adv-agent__pron-test">
                          <button
                            className={`adv-agent__pron-btn ${pronTest.active && pronTest.agentId === agent.id ? 'adv-agent__pron-btn--active' : ''}`}
                            onClick={() => startPronTest(agent.id, agent.name)}
                            disabled={pronTest.active}
                            title="Test if the browser can recognize this name when you say it"
                          >
                            {pronTest.active && pronTest.agentId === agent.id ? '🎙 Listening...' : '🎙 Test Wake Word'}
                          </button>
                          {pronTest.agentId === agent.id && pronTest.status && (
                            <div className="adv-agent__pron-result">
                              <span className="adv-agent__pron-status">{pronTest.status}</span>
                              {pronTest.heard.length > 0 && (
                                <div className="adv-agent__pron-alts">
                                  <span className="adv-agent__pron-alts-label">Browser heard:</span>
                                  {pronTest.heard.map((h, i) => (
                                    <span key={i} className="adv-agent__pron-alt">
                                      "{h.text}" ({h.confidence}%)
                                      {h.text.toLowerCase().replace(/[.!?,;:]+$/, '') !== agent.name.toLowerCase().trim() && (
                                        <button
                                          className="adv-agent__pron-add-alias"
                                          onClick={() => addAlias(agent.id, h.text)}
                                          title={`Add "${h.text}" as a wake word alias`}
                                        >+ alias</button>
                                      )}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {/* Current aliases */}
                              {(agent.wakeWordAliases || []).length > 0 && (
                                <div className="adv-agent__aliases">
                                  <span className="adv-agent__aliases-label">Wake word aliases:</span>
                                  {agent.wakeWordAliases.map(alias => (
                                    <span key={alias} className="adv-agent__alias-pill">
                                      {alias}
                                      <button
                                        className="adv-agent__alias-remove"
                                        onClick={() => removeAlias(agent.id, alias)}
                                      >×</button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Behavior file select */}
                        <div className="adv-agent__behavior">
                          <label className="adv-agent__behavior-label">Behavior:</label>
                          <select
                            className="adv-agent__behavior-select"
                            value={agent.behaviorFile || ''}
                            onChange={e => updateAgent(agent.id, { behaviorFile: e.target.value })}
                          >
                            <option value="">No behavior file</option>
                            {behaviors.map(b => (
                              <option key={b.filename} value={b.filename}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Voice select */}
                        {speech?.ttsSupported && speech.voices?.length > 0 && (
                          <div className="adv-agent__voice">
                            <label className="adv-agent__voice-label">🔊 Voice:</label>
                            <select
                              className="adv-agent__voice-select"
                              value={agent.voiceURI || ''}
                              onChange={e => {
                                updateAgent(agent.id, { voiceURI: e.target.value });
                                if (e.target.value) {
                                  speech.previewVoice(e.target.value, agent.name);
                                }
                              }}
                            >
                              <option value="">Default voice</option>
                              {(() => {
                                const grouped = categorizeVoices(speech.voices);
                                return (
                                  <>
                                    {grouped.local.length > 0 && (
                                      <optgroup label="Local Voices">
                                        {grouped.local.map(v => (
                                          <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                                        ))}
                                      </optgroup>
                                    )}
                                    {grouped.remote.length > 0 && (
                                      <optgroup label="Online Voices">
                                        {grouped.remote.map(v => (
                                          <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                                        ))}
                                      </optgroup>
                                    )}
                                  </>
                                );
                              })()}
                            </select>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="adv-agent__actions">
                        {settings.selectedAgentId !== agent.id && (
                          <button
                            className="adv-agent__btn adv-agent__btn--select"
                            onClick={() => updateSetting('selectedAgentId', agent.id)}
                            title="Set as active agent"
                          >
                            Select
                          </button>
                        )}
                        {settings.selectedAgentId === agent.id && (
                          <span className="adv-agent__active-badge">✓ Active</span>
                        )}
                        {!agent.isDefault && (
                          <button
                            className="adv-agent__btn adv-agent__btn--delete"
                            onClick={() => deleteAgent(agent.id)}
                            title="Delete agent"
                          >
                            🗑
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                <button className="adv-agents__add" onClick={addAgent}>
                  <span>+</span> Create New Agent
                </button>
              </div>

              {/* Hidden file input for avatar upload */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => {
                  const agentId = fileInputRef.current?.getAttribute('data-agent-id');
                  if (agentId && e.target.files?.[0]) {
                    handleAvatarUpload(agentId, e.target.files[0]);
                  }
                  e.target.value = '';
                }}
              />

              {/* Behavior Files Section */}
              <div className="adv-group" style={{ marginTop: 24 }}>
                <div className="adv-section-header" onClick={() => setShowBehaviors(!showBehaviors)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="adv-section-toggle">{showBehaviors ? '▼' : '▶'}</span>
                    <label className="adv-group__label" style={{ cursor: 'pointer', marginBottom: 0 }}>Behavior Files</label>
                  </div>
                  {showBehaviors && (
                    <button
                      className="adv-file-add-btn"
                      onClick={(e) => { e.stopPropagation(); openFileEditor('behavior', 'new_behavior.txt', '', true); }}
                      title="Create new behavior file"
                    >
                      + New
                    </button>
                  )}
                </div>
                {showBehaviors && (
                  <>
                    <p className="adv-group__desc" style={{ marginTop: 8 }}>
                      Behavior files define how your agents respond. Each agent can use a different behavior as its system prompt.
                    </p>
                    <div className="adv-file-list">
                  {behaviors.map(b => (
                    <div key={b.filename} className="adv-file-item">
                      <span className="adv-file-item__icon">📄</span>
                      <span className="adv-file-item__name">{b.name}</span>
                      <div className="adv-file-item__actions">
                        <button
                          className="adv-file-item__btn"
                          onClick={() => editFile('behavior', b.filename)}
                          title="Edit behavior"
                        >
                          ✏️
                        </button>
                        {b.filename !== 'default.txt' && (
                          <button
                            className="adv-file-item__btn adv-file-item__btn--delete"
                            onClick={() => deleteFile('behavior', b.filename)}
                            title="Delete behavior"
                          >
                            🗑
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                    </div>
                  </>
                )}
              </div>

              {/* Memory Files Section */}
              <div className="adv-group" style={{ marginTop: 16 }}>
                <div className="adv-section-header" onClick={() => setShowMemory(!showMemory)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="adv-section-toggle">{showMemory ? '▼' : '▶'}</span>
                    <label className="adv-group__label" style={{ cursor: 'pointer', marginBottom: 0 }}>Memory Files</label>
                  </div>
                  {showMemory && (
                    <button
                      className="adv-file-add-btn"
                      onClick={(e) => { e.stopPropagation(); openFileEditor('memory', 'new_memory.txt', '', true); }}
                      title="Create new memory file"
                    >
                      + New
                    </button>
                  )}
                </div>
                {showMemory && (
                  <>
                    <p className="adv-group__desc" style={{ marginTop: 8 }}>
                      Memory files provide persistent context and knowledge that can be referenced by agents.
                    </p>
                    <div className="adv-file-list">
                  {memoryFiles.length === 0 ? (
                    <div className="adv-file-item" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      No memory files yet
                    </div>
                  ) : (
                    memoryFiles.map(f => (
                      <div key={f.filename} className="adv-file-item">
                        <span className="adv-file-item__icon">📄</span>
                        <span className="adv-file-item__name">{f.name}</span>
                        <div className="adv-file-item__actions">
                          <button
                            className="adv-file-item__btn"
                            onClick={() => editFile('memory', f.filename)}
                            title="Edit memory file"
                          >
                            ✏️
                          </button>
                          <button
                            className="adv-file-item__btn adv-file-item__btn--delete"
                            onClick={() => deleteFile('memory', f.filename)}
                            title="Delete memory file"
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                    </div>
                  </>
                )}
              </div>

              {/* Personality Files Section */}
              <div className="adv-group" style={{ marginTop: 16 }}>
                <div className="adv-section-header" onClick={() => setShowPersonality(!showPersonality)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="adv-section-toggle">{showPersonality ? '▼' : '▶'}</span>
                    <label className="adv-group__label" style={{ cursor: 'pointer', marginBottom: 0 }}>Personality Files</label>
                  </div>
                  {showPersonality && (
                    <button
                      className="adv-file-add-btn"
                      onClick={(e) => { e.stopPropagation(); openFileEditor('personality', 'new_file.md', '', true); }}
                      title="Create new personality file"
                    >
                      + New
                    </button>
                  )}
                </div>
                {showPersonality && (
                  <>
                    <p className="adv-group__desc" style={{ marginTop: 8 }}>
                      Personality files (identity.md, soul.md, user.md) define your assistant's character, values, and knowledge about you. They are automatically included in every conversation.
                    </p>
                    <div className="adv-file-list">
                  {personalityFiles.length === 0 ? (
                    <div className="adv-file-item" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      No personality files yet
                    </div>
                  ) : (
                    personalityFiles.map(f => (
                      <div key={f.filename} className="adv-file-item">
                        <span className="adv-file-item__icon">🧠</span>
                        <span className="adv-file-item__name">{f.name}</span>
                        <div className="adv-file-item__actions">
                          <button
                            className="adv-file-item__btn"
                            onClick={() => editFile('personality', f.filename)}
                            title="Edit personality file"
                          >
                            ✏️
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ─── Network Tab ──────────────────────────────────────── */}
          {activeTab === 'network' && (
            <div className="adv-section">
              <div className="adv-group">
                <label className="adv-group__label">Connection Status</label>
                <div className={`adv-status ${isOnline ? 'adv-status--online' : 'adv-status--offline'}`}>
                  <span>{isOnline ? '🟢' : '⚫'}</span>
                  <span>{isOnline ? 'Connected to server' : 'Disconnected from server'}</span>
                </div>
              </div>

              {networkInfo && networkInfo.addresses.length > 0 && (
                <div className="adv-group">
                  <label className="adv-group__label">Access from other devices</label>
                  <p className="adv-group__desc">Use these URLs to access the webapp from your phone, tablet, or other computers on the same network.</p>
                  <div className="adv-network-list">
                    {networkInfo.addresses.map((addr, i) => (
                      <div key={i} className="adv-network-item">
                        <span className="adv-network-item__label">{addr.interface}:</span>
                        <a
                          href={addr.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="adv-network-item__link"
                        >
                          {addr.url}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="adv-group">
                <label className="adv-group__label">Server Info</label>
                <div className="adv-info-grid">
                  <div className="adv-info-row">
                    <span className="adv-info-key">Hostname:</span>
                    <span className="adv-info-value">{networkInfo?.hostname || '—'}</span>
                  </div>
                  <div className="adv-info-row">
                    <span className="adv-info-key">Port:</span>
                    <span className="adv-info-value">{networkInfo?.port || '—'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* File Editor Modal */}
        {fileEditor.isOpen && (
          <div className="adv-file-editor-overlay" onClick={closeFileEditor}>
            <div className="adv-file-editor-modal" onClick={e => e.stopPropagation()}>
              <div className="adv-file-editor-header">
                <h3 className="adv-file-editor-title">
                  {fileEditor.isNew ? 'Create' : 'Edit'} {fileEditor.type === 'behavior' ? 'Behavior' : 'Memory'} File
                </h3>
                <button className="adv-header__close" onClick={closeFileEditor}>✕</button>
              </div>
              <div className="adv-file-editor-body">
                <div className="adv-file-editor-field">
                  <label className="adv-file-editor-label">Filename</label>
                  <input
                    type="text"
                    className="adv-file-editor-input"
                    value={fileEditor.filename}
                    onChange={e => setFileEditor({ ...fileEditor, filename: e.target.value })}
                    disabled={!fileEditor.isNew}
                    placeholder="filename.txt"
                  />
                </div>
                <div className="adv-file-editor-field">
                  <label className="adv-file-editor-label">Content</label>
                  <textarea
                    className="adv-file-editor-textarea"
                    value={fileEditor.content}
                    onChange={e => setFileEditor({ ...fileEditor, content: e.target.value })}
                    placeholder={fileEditor.type === 'behavior' 
                      ? 'Enter the system prompt or behavior instructions...' 
                      : 'Enter memory content or context information...'}
                    rows={15}
                  />
                </div>
              </div>
              <div className="adv-file-editor-footer">
                <button className="adv-file-editor-btn adv-file-editor-btn--cancel" onClick={closeFileEditor}>
                  Cancel
                </button>
                <button 
                  className="adv-file-editor-btn adv-file-editor-btn--save" 
                  onClick={saveFile}
                  disabled={!fileEditor.filename || !fileEditor.content}
                >
                  {fileEditor.isNew ? 'Create' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="adv-footer">
          <span className="adv-footer__autosave">Changes are saved automatically</span>
          <button className="adv-footer__close" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

export default AdvancedSettings;
