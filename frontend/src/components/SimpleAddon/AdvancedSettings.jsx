import React, { useState, useEffect, useRef, useCallback } from 'react';
import { categorizeVoices } from '../../hooks/simpleAddon/useSpeech';
import {
  getBehaviors, getMemoryFiles, getPersonalityFiles, getNetworkInfo,
  saveAddonSettings, getBehaviorContent, getMemoryContent, getPersonalityContent,
  createBehavior, updateBehavior, deleteBehavior,
  createMemory, updateMemory, deleteMemory,
  updatePersonality,
  getAddonBaseUrl,
  voiceListen, voiceStopListening,
  listAddonDevices, onAddonDevicesChange, getAddonDevices,
  getSelectedRemoteDeviceId, setSelectedRemoteDeviceId,
} from '../../services/simpleAddonApi';
import './AdvancedSettings.css';
import AIWorkflowSettings from './AIWorkflowSettings.jsx';
import WorkspaceManager from './WorkspaceManager.jsx';
import WorkspaceProfilesManager from './WorkspaceProfilesManager.jsx';
import ShortcutsManager from './ShortcutsManager.jsx';
import GoalManager from './GoalManager.jsx';
import PermissionsManager from './PermissionsManager.jsx';

const TABS = [
  { id: 'general', label: '⚙ General' },
  { id: 'agents', label: '🤖 Agents' },
  { id: 'goals', label: '🎯 Goals' },
  { id: 'shortcuts', label: '⌨ Shortcuts' },
  { id: 'workspace', label: '🧠 Workspace' },
  { id: 'permissions', label: '🔒 Permissions' },
  { id: 'network', label: '🌐 Network' },
];

function AdvancedSettings({ isOpen, onClose, settings, onSettingsChange, isOnline, speech, micDevices, user, cloudSyncStatus, addonConnected, isAddonOutdated, initialTab, portfolioLLMProviders, onSendMessage, onExportChat, hasMessages }) {
  const [activeTab, setActiveTab] = useState('general');
  const [workspaceSubTab, setWorkspaceSubTab] = useState('profiles');
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
  const [addonListening, setAddonListening] = useState(false); // Whisper mic active
  const [addonListenError, setAddonListenError] = useState(null);
  const [remoteDevices, setRemoteDevices] = useState(getAddonDevices());
  const [selectedRemoteDevice, setSelectedRemoteDevice] = useState(getSelectedRemoteDeviceId() || '');
  const fileInputRef = useRef(null);
  const autoSaveTimer = useRef(null);

  // Jump straight to the requested tab whenever the modal is opened with one
  // (e.g. the sidebar's "Manage macros →" link opens directly to Shortcuts).
  useEffect(() => {
    if (isOpen && initialTab) setActiveTab(initialTab);
  }, [isOpen, initialTab]);

  // Load behaviors and memory files
  useEffect(() => {
    if (!isOpen) return;
    getBehaviors()
      .then(data => setBehaviors(data.behaviors || []))
      .catch(() => {});

    getMemoryFiles()
      .then(data => setMemoryFiles(data.files || []))
      .catch(() => {});

    getPersonalityFiles()
      .then(data => setPersonalityFiles(data.files || []))
      .catch(() => {});

    getNetworkInfo()
      .then(data => setNetworkInfo(data))
      .catch(() => {});
  }, [isOpen]);

  // Cloud-relay device directory — lists every PC with the addon signed into
  // this account, so a phone/tablet can target a specific device remotely.
  useEffect(() => {
    const unsub = onAddonDevicesChange(setRemoteDevices);
    if (isOpen && user?.token) {
      listAddonDevices(user.token).catch(() => {});
      const id = setInterval(() => listAddonDevices(user.token).catch(() => {}), 15000);
      return () => { unsub(); clearInterval(id); };
    }
    return unsub;
  }, [isOpen, user?.token]);

  // Auto-save settings when they change
  const autoSave = useCallback((newSettings) => {
    onSettingsChange(newSettings);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      saveAddonSettings(newSettings).catch(() => {});
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

  // ── Quick voice-to-message (moved here from the chat header) ────────────
  const toggleVoiceMessage = useCallback(() => {
    if (!speech) return;
    if (speech.isListening) {
      speech.stopListening();
    } else {
      speech.startListening((text) => {
        if (text.trim()) onSendMessage?.(text.trim());
      });
    }
  }, [speech, onSendMessage]);

  const toggleWhisperVoiceMessage = useCallback(async () => {
    if (addonListening) {
      setAddonListening(false);
      voiceStopListening().catch(() => {});
      return;
    }
    setAddonListening(true);
    setAddonListenError(null);
    try {
      const result = await voiceListen({ maxSeconds: 10, silenceMs: 800 });
      const text = result?.text?.trim();
      if (text) {
        onSendMessage?.(text);
      } else {
        setAddonListenError('Nothing heard');
        setTimeout(() => setAddonListenError(null), 2000);
      }
    } catch (e) {
      const msg = e.message?.slice(0, 80) || 'Mic error';
      const hint = (msg.includes('Cannot') || msg.includes('404')) ? 'Restart addon (tray → Restart Server)' : msg;
      setAddonListenError(hint);
      setTimeout(() => setAddonListenError(null), 4000);
    } finally {
      setAddonListening(false);
    }
  }, [addonListening, onSendMessage]);

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

  const handleAvatarUpload = useCallback((agentId, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      if (dataUrl) {
        updateAgent(agentId, { avatarUrl: dataUrl });
      }
    };
    reader.onerror = () => console.error('Avatar read failed');
    reader.readAsDataURL(file);
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

    try {
      if (isNew) {
        // Create new file
        if (type === 'behavior') await createBehavior(filename, content);
        else if (type === 'memory') await createMemory(filename, content);
        // Personality files can only be edited, not created
      } else {
        // Update existing file
        if (type === 'behavior') await updateBehavior(filename, content);
        else if (type === 'personality') await updatePersonality(filename, content);
        else await updateMemory(filename, content);
      }

      // Reload the file list
      if (type === 'behavior') {
        const data = await getBehaviors();
        setBehaviors(data.behaviors || []);
      } else if (type === 'personality') {
        const data = await getPersonalityFiles();
        setPersonalityFiles(data.files || []);
      } else {
        const data = await getMemoryFiles();
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

    try {
      if (type === 'behavior') await deleteBehavior(filename);
      else if (type === 'memory') await deleteMemory(filename);
      // Personality files cannot be deleted

      // Reload the file list
      if (type === 'behavior') {
        const data = await getBehaviors();
        setBehaviors(data.behaviors || []);
      } else if (type === 'personality') {
        const data = await getPersonalityFiles();
        setPersonalityFiles(data.files || []);
      } else {
        const data = await getMemoryFiles();
        setMemoryFiles(data.files || []);
      }
    } catch (err) {
      console.error('File delete error:', err);
      alert(`Failed to delete file: ${err.message}`);
    }
  }, []);

  const editFile = useCallback(async (type, filename) => {
    try {
      let content;
      if (type === 'behavior') {
        const data = await getBehaviorContent(filename);
        content = typeof data === 'string' ? data : data.content;
      } else if (type === 'personality') {
        const data = await getPersonalityContent(filename);
        content = data.content;
      } else {
        const data = await getMemoryContent(filename);
        content = data.content;
      }
      openFileEditor(type, filename, content, false);
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
                    <label className="adv-group__label">Theme</label>
                    <p className="adv-group__desc">Application color scheme</p>
                  </div>
                  <select
                    className="adv-select"
                    value={settings.theme || 'system'}
                    onChange={e => updateSetting('theme', e.target.value)}
                  >
                    <option value="dark">🌑 Dark</option>
                    <option value="light">☀️ Light</option>
                    <option value="system">💻 System (matches site theme)</option>
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

              {/* ─── Chat Tools (moved from the chat header) ─────────── */}
              <div className="adv-group">
                <label className="adv-group__label">Chat Tools</label>
                <p className="adv-group__desc">Export the current chat or send a message using your voice.</p>
                <div className="adv-mic-list">
                  <button
                    type="button"
                    className="adv-mic-item"
                    onClick={() => onExportChat?.('markdown')}
                    disabled={!onExportChat || !hasMessages}
                    title="Export chat as Markdown"
                  >
                    <span className="adv-mic-item__radio" aria-hidden="true">📥</span>
                    <span className="adv-mic-item__label">Export Chat</span>
                  </button>
                  {speech?.sttSupported && (
                    <button
                      type="button"
                      className={`adv-mic-item ${speech.isListening ? 'adv-mic-item--selected' : ''}`}
                      onClick={toggleVoiceMessage}
                      title={speech.isListening ? 'Stop listening' : 'Speak a message (browser voice input)'}
                    >
                      <span className="adv-mic-item__radio" aria-hidden="true">🎤</span>
                      <span className="adv-mic-item__label">
                        {speech.isListening ? 'Listening… click to stop' : 'Voice Message (Browser)'}
                      </span>
                    </button>
                  )}
                  {addonConnected && !isAddonOutdated && (
                    <button
                      type="button"
                      className={`adv-mic-item ${addonListening ? 'adv-mic-item--selected' : ''}`}
                      onClick={toggleWhisperVoiceMessage}
                      title={addonListening ? 'Stop Whisper recording' : 'Speak a message via Whisper AI (addon)'}
                    >
                      <span className="adv-mic-item__radio" aria-hidden="true">{addonListening ? '🎙' : '🎙️'}</span>
                      <span className="adv-mic-item__label">
                        {addonListening ? 'Listening… click to stop' : 'Voice Message (Whisper)'}
                      </span>
                    </button>
                  )}
                </div>
                {addonListenError && (
                  <p className="adv-mic-list__empty">{addonListenError}</p>
                )}
              </div>

              {/* ─── Shared AI workflow settings (same data as the Settings page) ─── */}
              <h3 className="adv-section__subtitle">🧠 AI &amp; chat preferences</h3>
              <AIWorkflowSettings
                settings={settings}
                onChange={updateSetting}
                user={user}
                cloudSyncStatus={cloudSyncStatus}
                sttSupported={speech?.sttSupported}
                portfolioLLMProviders={portfolioLLMProviders}
              />

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
                        {agent.avatarUrl && (agent.avatarUrl.startsWith('data:') || agent.avatarUrl.startsWith('https://') || agent.avatarUrl.startsWith('http://')) ? (
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

          {activeTab === 'goals' && (
            <div className="adv-section">
              <GoalManager user={user} addonConnected={!!addonConnected} addonBaseUrl={getAddonBaseUrl()} />
            </div>
          )}

          {activeTab === 'workspace' && (
            <div className="adv-section">
              <div className="adv-subtabs">
                <button
                  type="button"
                  className={`adv-subtabs__tab ${workspaceSubTab === 'profiles' ? 'adv-subtabs__tab--active' : ''}`}
                  onClick={() => setWorkspaceSubTab('profiles')}
                >
                  🗂 Saved Workspaces
                </button>
                <button
                  type="button"
                  className={`adv-subtabs__tab ${workspaceSubTab === 'memory' ? 'adv-subtabs__tab--active' : ''}`}
                  onClick={() => setWorkspaceSubTab('memory')}
                >
                  📚 AI Memory &amp; Skills
                </button>
              </div>

              {workspaceSubTab === 'profiles' ? (
                <>
                  <p className="adv-section__intro">
                    Save the current arrangement of every open window on this PC, then restore it with one click later — e.g. a "Coding setup" or "Streaming setup" profile.
                  </p>
                  <WorkspaceProfilesManager addonConnected={!!addonConnected} />
                </>
              ) : (
                <WorkspaceManager user={user} />
              )}
            </div>
          )}

          {activeTab === 'permissions' && (
            <div className="adv-section">
              <PermissionsManager addonConnected={!!addonConnected} />
            </div>
          )}

          {activeTab === 'shortcuts' && (
            <div className="adv-section">
              <ShortcutsManager user={user} addonConnected={!!addonConnected} />
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

              {/* ── Your Devices (profile-linked remote control) ───── */}
              <div className="adv-group">
                <label className="adv-group__label">Your Devices</label>
                <p className="adv-group__desc">
                  Every PC running the Simple addon and signed into this account. Select one to control it
                  from this device or your phone — anywhere, no same-WiFi or QR code needed.
                </p>
                {!user ? (
                  <p className="adv-mic-list__empty">Log in to see your addon devices.</p>
                ) : remoteDevices.length === 0 ? (
                  <p className="adv-mic-list__empty">No addon devices seen yet. Start the addon on a PC and wait a moment.</p>
                ) : (
                  <div className="adv-device-list">
                    {remoteDevices.map(dev => {
                      const selected = selectedRemoteDevice === dev.deviceId;
                      const lastSeen = dev.lastSeen ? new Date(dev.lastSeen).toLocaleString() : '—';
                      return (
                        <button
                          key={dev.deviceId}
                          type="button"
                          className={`adv-device-item ${selected ? 'adv-device-item--selected' : ''}`}
                          onClick={() => {
                            const next = selected ? null : dev.deviceId;
                            setSelectedRemoteDevice(next || '');
                            setSelectedRemoteDeviceId(next);
                          }}
                          title={selected ? 'Click to deselect this device' : 'Use this device for remote control'}
                        >
                          <span className={`adv-device-item__dot ${dev.online ? 'adv-device-item__dot--online' : ''}`} />
                          <span className="adv-device-item__main">
                            <span className="adv-device-item__name">{dev.hostname || 'Unknown PC'}</span>
                            <span className="adv-device-item__meta">
                              {dev.online ? 'Online' : 'Offline'} · v{dev.version || '?'} · last seen {lastSeen}
                            </span>
                          </span>
                          {selected && <span className="adv-device-item__badge">✓ Selected</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {selectedRemoteDevice && (
                  <p className="adv-group__desc" style={{ marginTop: 8 }}>
                    Remote control is targeting{' '}
                    <strong>
                      {remoteDevices.find(d => d.deviceId === selectedRemoteDevice)?.hostname || selectedRemoteDevice}
                    </strong>
                    .
                  </p>
                )}
              </div>

              <div className="adv-group">
                <label className="adv-group__label">This Device</label>
                <p className="adv-group__desc">How other signed-in devices see this machine.</p>
                <div className="adv-info-grid">
                  <div className="adv-info-row">
                    <span className="adv-info-key">Addon:</span>
                    <span className="adv-info-value">{addonConnected ? '🟢 Running' : '⚫ Not running'}</span>
                  </div>
                  <div className="adv-info-row">
                    <span className="adv-info-key">Hostname:</span>
                    <span className="adv-info-value">{networkInfo?.hostname || '—'}</span>
                  </div>
                  <div className="adv-info-row">
                    <span className="adv-info-key">Local port:</span>
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
