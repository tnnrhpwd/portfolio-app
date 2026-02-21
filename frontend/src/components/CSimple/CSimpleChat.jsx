import React, { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './Sidebar';
import ChatWindow from './ChatWindow';
import AdvancedSettings from './AdvancedSettings';
import { useSpeech } from '../../hooks/csimple/useSpeech';
import { useMicDevices } from '../../hooks/csimple/useMicDevices';
import { useInactivity } from '../../hooks/csimple/useInactivity';
import {
  sendChatMessage,
  confirmAction,
  stopGeneration as apiStopGeneration,
  getAddonSettings,
  saveAddonSettings,
  getBehaviorContent,
  getCloudSettings,
  saveCloudSettings,
  getCloudConversations,
  saveCloudConversations,
} from '../../services/csimpleApi';
import './CSimpleChat.css';
import './CSimpleTheme.css';
import { checkMessage as securityCheckMessage } from '../../utils/csimple/securityGuard';

const DEFAULT_MODEL = 'Qwen/Qwen2.5-0.5B-Instruct';
const CHATS_STORAGE_KEY = 'csimple_chats';
const ACTIVE_CHAT_KEY = 'csimple_active_chat';
const DEVICE_LOCAL_KEYS = ['micDeviceId', 'sttEnabled'];
const DEVICE_SETTINGS_KEY = 'csimple_device_settings';

function getDeviceLocalSettings() {
  try {
    const saved = localStorage.getItem(DEVICE_SETTINGS_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch { return {}; }
}

function saveDeviceLocalSetting(key, value) {
  const current = getDeviceLocalSettings();
  current[key] = value;
  localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(current));
}

const DEFAULT_SETTINGS = {
  saveChatsLocally: true,
  theme: 'dark',
  fontSize: 'medium',
  sendWithEnter: true,
  showTimestamps: true,
  enableMarkdown: true,
  maxConversationHistory: 50,
  defaultTemperature: 0.7,
  defaultMaxTokens: 500,
  agents: [{ id: 'default', name: 'C-Simple AI', behaviorFile: 'default.txt', avatarUrl: null, voiceURI: '' }],
  selectedAgentId: 'default',
  ttsEnabled: true,
  sttEnabled: false,
  micDeviceId: '',
  llmProvider: 'portfolio',   // Default to portfolio cloud when no addon
  githubToken: '',
  githubModel: 'gpt-4o-mini',
  portfolioModel: 'gpt-4o-mini',
  cloudSync: false,
};

/**
 * CSimpleChat — the main AI chat interface.
 * 
 * This is the CSimple.Webapp UI integrated into the portfolio app.
 * It supports three LLM providers:
 *   1. Portfolio backend (cloud) — uses Redux compressData
 *   2. Local addon (HuggingFace) — direct fetch to localhost
 *   3. GitHub Models — via addon or direct
 * 
 * @param {object} props
 * @param {object} props.addonStatus - { isConnected, baseUrl, version }
 * @param {object} props.user - Portfolio auth user (from Redux)
 * @param {object} props.portfolioLLMProviders - LLM providers from portfolio backend
 * @param {function} props.onPortfolioChat - Callback to send chat via portfolio backend
 * @param {boolean} props.portfolioChatLoading - Whether portfolio chat is loading
 * @param {string} props.portfolioChatResponse - Response from portfolio backend
 */
function CSimpleChat({
  addonStatus,
  user,
  portfolioLLMProviders,
  onPortfolioChat,
  portfolioChatLoading,
  portfolioChatResponse,
}) {
  const rootRef = useRef(null);
  const isAddonConnected = addonStatus?.isConnected ?? false;

  const [conversations, setConversations] = useState(() => {
    try {
      const saved = localStorage.getItem(CHATS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [{ id: '1', title: 'New Chat', messages: [], createdAt: new Date().toISOString() }];
  });
  const [activeConversationId, setActiveConversationId] = useState(() => {
    return localStorage.getItem(ACTIVE_CHAT_KEY) || '1';
  });
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  // behaviorContent is loaded from addon and used in API calls via the settings/agent flow
  // eslint-disable-next-line no-unused-vars
  const [behaviorContent, setBehaviorContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState(null); // null | 'syncing' | 'synced' | 'error'
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);
  const handleConfirmRef = useRef(null);
  const cloudSettingsTimer = useRef(null);
  const cloudConvosTimer = useRef(null);
  const lastCloudSettingsUpdate = useRef(null);
  const lastCloudConvosUpdate = useRef(null);
  const cloudSyncInitialized = useRef(false);

  const activeConversation = conversations.find(c => c.id === activeConversationId);
  const activeAgent = settings.agents?.find(a => a.id === settings.selectedAgentId) || settings.agents?.[0];

  // Initialize speech
  const speech = useSpeech({
    agentName: activeAgent?.name || '',
    wakeWordAliases: activeAgent?.wakeWordAliases || [],
    voiceURI: activeAgent?.voiceURI || '',
    ttsEnabled: settings.ttsEnabled ?? true,
    sttEnabled: settings.sttEnabled ?? false,
    micDeviceId: settings.micDeviceId || '',
  });

  const micDevices = useMicDevices();
  const { isInactive, resume: resumeActivity } = useInactivity(3 * 60 * 1000);
  const wasInactiveRef = useRef(false);
  const sendMessageRef = useRef(null);

  // Wake word / STT setup (same as original)
  useEffect(() => {
    sendMessageRef.current = (text) => {
      if (text.trim()) sendMessageRef._send?.(text.trim());
    };
  });

  const wakeCallbackRef = useRef(null);
  useEffect(() => {
    wakeCallbackRef.current = (command) => {
      if (command && command.trim()) {
        sendMessageRef._send?.(command.trim());
        const restartPassive = () => {
          try { speech.startPassiveListening((cmd) => wakeCallbackRef.current?.(cmd)); } catch {}
        };
        setTimeout(() => { if (settings.sttEnabled ?? false) restartPassive(); }, 3000);
      } else {
        speech.startListening((text) => {
          if (text.trim()) sendMessageRef._send?.(text.trim());
          setTimeout(() => {
            speech.stopListening();
            setTimeout(() => {
              if (settings.sttEnabled ?? false) {
                try { speech.startPassiveListening((cmd) => wakeCallbackRef.current?.(cmd)); } catch {}
              }
            }, 1500);
          }, 500);
        });
      }
    };
  });

  useEffect(() => {
    if ((settings.sttEnabled ?? false) && speech.sttSupported && !speech.isListening) {
      speech.startPassiveListening((command) => wakeCallbackRef.current?.(command));
    } else if (!(settings.sttEnabled ?? false)) {
      speech.stopPassiveListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.sttEnabled, speech.sttSupported]);

  // Inactivity pause
  useEffect(() => {
    if (isInactive && !wasInactiveRef.current) {
      wasInactiveRef.current = true;
      speech.stopPassiveListening();
    } else if (!isInactive && wasInactiveRef.current) {
      wasInactiveRef.current = false;
      if ((settings.sttEnabled ?? false) && speech.sttSupported) {
        setTimeout(() => {
          speech.startPassiveListening((cmd) => wakeCallbackRef.current?.(cmd));
        }, 500);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInactive]);

  // Load settings from addon if connected, otherwise use defaults
  useEffect(() => {
    if (isAddonConnected) {
      getAddonSettings()
        .then(data => {
          if (data && typeof data === 'object') {
            const deviceLocal = getDeviceLocalSettings();
            const merged = { ...data };
            for (const key of DEVICE_LOCAL_KEYS) {
              if (key in deviceLocal) merged[key] = deviceLocal[key];
            }
            // One-time migration: if server doesn't have githubToken yet but localStorage does, use it
            if (!merged.githubToken && deviceLocal.githubToken) {
              merged.githubToken = deviceLocal.githubToken;
            }
            setSettings(prev => ({ ...prev, ...merged }));
          }
          setIsSettingsLoaded(true);
        })
        .catch(() => { setIsSettingsLoaded(true); });
    } else {
      setIsSettingsLoaded(true);
    }
  }, [isAddonConnected]);

  // Apply CSimple theme to the container element (not document root)
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const theme = settings.theme || 'dark';
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-csimple-theme', prefersDark ? 'dark' : 'light');
      const handler = (e) => root.setAttribute('data-csimple-theme', e.matches ? 'dark' : 'light');
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } else {
      root.setAttribute('data-csimple-theme', theme);
    }
  }, [settings.theme]);

  useEffect(() => {
    if (rootRef.current) {
      rootRef.current.setAttribute('data-csimple-font-size', settings.fontSize || 'medium');
    }
  }, [settings.fontSize]);

  // Load behavior file content
  useEffect(() => {
    const file = activeAgent?.behaviorFile;
    if (!file || file === 'none') {
      setBehaviorContent('You are a helpful AI assistant powered by C-Simple. Answer clearly and concisely.');
      return;
    }
    if (isAddonConnected) {
      getBehaviorContent(file)
        .then(text => setBehaviorContent(text || ''))
        .catch(() => setBehaviorContent(''));
    }
  }, [activeAgent?.behaviorFile, isAddonConnected]);

  // Persist chats
  useEffect(() => {
    if (settings.saveChatsLocally) {
      try { localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(conversations)); } catch {}
    }
  }, [conversations, settings.saveChatsLocally]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_CHAT_KEY, activeConversationId);
  }, [activeConversationId]);

  // ─── Cloud Sync: Initial load on login ────────────────────────────────────
  useEffect(() => {
    if (!user?.token || !isSettingsLoaded || cloudSyncInitialized.current) return;

    // Check if cloudSync was previously enabled (from localStorage or current settings)
    const checkAndLoadCloud = async () => {
      try {
        const cloudData = await getCloudSettings(user.token);
        if (cloudData?.settings) {
          const cloudSettings = cloudData.settings;
          // If cloud has cloudSync enabled, merge cloud settings in
          if (cloudSettings.cloudSync) {
            const deviceLocal = getDeviceLocalSettings();
            const merged = { ...settings };
            // Cloud wins for non-device-local keys
            for (const [key, value] of Object.entries(cloudSettings)) {
              if (!DEVICE_LOCAL_KEYS.includes(key)) {
                // Use cloud value if it's newer or if local doesn't have a meaningful override
                merged[key] = value;
              }
            }
            // Re-apply device-local keys (micDeviceId, sttEnabled)
            for (const key of DEVICE_LOCAL_KEYS) {
              if (key in deviceLocal) merged[key] = deviceLocal[key];
            }
            // One-time migration: if cloud doesn't have githubToken yet but localStorage does, use it
            if (!merged.githubToken && deviceLocal.githubToken) {
              merged.githubToken = deviceLocal.githubToken;
            }
            setSettings(merged);

            // Also load cloud conversations if enabled
            try {
              const convData = await getCloudConversations(user.token);
              if (convData?.conversations && Array.isArray(convData.conversations)) {
                // Merge: add cloud conversations that don't exist locally (by ID)
                setConversations(prev => {
                  const localIds = new Set(prev.map(c => c.id));
                  const cloudOnly = convData.conversations.filter(c => !localIds.has(c.id));
                  if (cloudOnly.length > 0) {
                    return [...prev, ...cloudOnly];
                  }
                  return prev;
                });
              }
            } catch (convErr) {
              console.warn('[CSimple] Failed to load cloud conversations:', convErr);
            }

            setCloudSyncStatus('synced');
          }
        } else if (settings.cloudSync && user.token) {
          // Cloud is empty but local has sync enabled — push local settings up
          const toSync = { ...settings };
          DEVICE_LOCAL_KEYS.forEach(k => delete toSync[k]);
          await saveCloudSettings(user.token, toSync);
          setCloudSyncStatus('synced');
        }
      } catch (err) {
        console.warn('[CSimple] Cloud sync initial load failed:', err);
        setCloudSyncStatus('error');
      }
      cloudSyncInitialized.current = true;
    };

    checkAndLoadCloud();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token, isSettingsLoaded]);

  // ─── Cloud Sync: Debounced settings save ──────────────────────────────────
  useEffect(() => {
    if (!settings.cloudSync || !user?.token || !cloudSyncInitialized.current) return;

    if (cloudSettingsTimer.current) clearTimeout(cloudSettingsTimer.current);
    cloudSettingsTimer.current = setTimeout(async () => {
      try {
        setCloudSyncStatus('syncing');
        const toSync = { ...settings };
        DEVICE_LOCAL_KEYS.forEach(k => delete toSync[k]);
        const result = await saveCloudSettings(user.token, toSync);
        lastCloudSettingsUpdate.current = result.updatedAt;
        setCloudSyncStatus('synced');
      } catch (err) {
        console.warn('[CSimple] Cloud settings sync failed:', err);
        setCloudSyncStatus('error');
      }
    }, 500);

    return () => {
      if (cloudSettingsTimer.current) clearTimeout(cloudSettingsTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, user?.token]);

  // ─── Cloud Sync: Debounced conversations save ────────────────────────────
  useEffect(() => {
    if (!settings.cloudSync || !user?.token || !cloudSyncInitialized.current) return;

    if (cloudConvosTimer.current) clearTimeout(cloudConvosTimer.current);
    cloudConvosTimer.current = setTimeout(async () => {
      try {
        setCloudSyncStatus('syncing');
        const result = await saveCloudConversations(user.token, conversations);
        lastCloudConvosUpdate.current = result.updatedAt;
        setCloudSyncStatus('synced');
      } catch (err) {
        console.warn('[CSimple] Cloud conversations sync failed:', err);
        setCloudSyncStatus('error');
      }
    }, 2000);

    return () => {
      if (cloudConvosTimer.current) clearTimeout(cloudConvosTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, user?.token, settings.cloudSync]);

  // Connection status — online if addon connected or if we can reach the portfolio
  useEffect(() => {
    setIsOnline(isAddonConnected || !!user);
  }, [isAddonConnected, user]);

  // Handle portfolio chat response
  useEffect(() => {
    if (portfolioChatResponse && !portfolioChatLoading) {
      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: portfolioChatResponse,
        timestamp: new Date().toISOString(),
        modelId: settings.portfolioModel || 'cloud',
      };

      setConversations(prev => prev.map(c => {
        if (c.id !== activeConversationId) return c;
        return { ...c, messages: [...c.messages, assistantMessage] };
      }));

      if (settings.ttsEnabled ?? true) {
        speech.speak(portfolioChatResponse);
      }

      setIsGenerating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioChatResponse, portfolioChatLoading]);

  const createNewChat = useCallback(() => {
    const newId = Date.now().toString();
    const newConv = { id: newId, title: 'New Chat', messages: [], createdAt: new Date().toISOString() };
    setConversations(prev => [newConv, ...prev]);
    setActiveConversationId(newId);
    setSidebarOpen(false);
  }, []);

  const deleteConversation = useCallback((id) => {
    setConversations(prev => {
      const updated = prev.filter(c => c.id !== id);
      if (updated.length === 0) {
        return [{ id: Date.now().toString(), title: 'New Chat', messages: [], createdAt: new Date().toISOString() }];
      }
      return updated;
    });
    if (activeConversationId === id) {
      setConversations(prev => {
        setActiveConversationId(prev[0]?.id);
        return prev;
      });
    }
  }, [activeConversationId]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || isGenerating) return;

    // ── Security Layer 0: client-side pre-screen before any network call ──────
    const secCheck = securityCheckMessage(text);
    if (secCheck.blocked) {
      const blockedMsg = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `⛔ **Command blocked by security policy**\n\n${secCheck.reason}\n\nFor safety, this command cannot be executed. If you believe this is a false positive, please rephrase your request.`,
        timestamp: new Date().toISOString(),
        isError: true,
      };
      const userMsg = {
        id: Date.now().toString(),
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
      };
      setConversations(prev => prev.map(c => {
        if (c.id !== activeConversationId) return c;
        return { ...c, messages: [...c.messages, userMsg, blockedMsg] };
      }));
      return;
    }

    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    setConversations(prev => prev.map(c => {
      if (c.id !== activeConversationId) return c;
      const updatedMessages = [...c.messages, userMessage];
      const title = c.messages.length === 0 ? text.substring(0, 40) + (text.length > 40 ? '...' : '') : c.title;
      return { ...c, messages: updatedMessages, title };
    }));

    setIsGenerating(true);

    try {
      const currentConv = conversations.find(c => c.id === activeConversationId);
      const history = currentConv ? currentConv.messages.map(m => ({
        role: m.role,
        content: m.content,
      })) : [];
      const trimmedHistory = history.slice(-(settings.maxConversationHistory ?? 50));

      const provider = settings.llmProvider || 'portfolio';

      if (provider === 'portfolio') {
        // Route through portfolio backend via Redux
        if (onPortfolioChat) {
          // Use GitHub Models if the user has a GitHub token configured, otherwise OpenAI
          const portfolioProvider = settings.githubToken ? 'github' : 'openai';
          const portfolioModel = settings.portfolioModel || 'gpt-4o-mini';
          onPortfolioChat(text, trimmedHistory, portfolioProvider, portfolioModel);
          // Response will come via portfolioChatResponse prop
        } else {
          throw new Error('Portfolio chat not available. Please log in.');
        }
        return; // Don't set isGenerating to false yet — wait for response
      }

      // Local addon or GitHub Models — direct fetch (requires addon)
      if (!isAddonConnected) {
        throw new Error(
          `Cannot use ${provider === 'github' ? 'GitHub Models' : 'local'} provider — the CSimple addon is not running. ` +
          'Switch to the Cloud (Portfolio) provider in Settings, or install and start the addon.'
        );
      }

      const model = provider === 'github'
        ? (settings.githubModel || 'gpt-4o-mini')
        : selectedModel;

      const data = await sendChatMessage({
        message: text,
        model,
        conversationHistory: trimmedHistory,
        settings,
        agent: activeAgent,
      });

      // Handle confirmation
      if (data.confirmation) {
        const confirmMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.response,
          timestamp: new Date().toISOString(),
          generationTime: data.generationTime,
          modelId: data.modelId,
        };

        setConversations(prev => prev.map(c => {
          if (c.id !== activeConversationId) return c;
          return { ...c, messages: [...c.messages, confirmMessage] };
        }));

        setPendingConfirmation(data.confirmation);

        if (settings.ttsEnabled ?? true) {
          const optionsText = data.confirmation.options.join(', ');
          speech.speak(`${data.confirmation.question} ${optionsText}`);
        }
        return;
      }

      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date().toISOString(),
        generationTime: data.generationTime,
        modelId: data.modelId,
        action: data.action || null,
        operations: data.operations || null,
      };

      setConversations(prev => prev.map(c => {
        if (c.id !== activeConversationId) return c;
        return { ...c, messages: [...c.messages, assistantMessage] };
      }));

      if (data.action?.description && (settings.ttsEnabled ?? true)) {
        speech.speak(data.action.description);
      }
    } catch (err) {
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `**Error:** ${err.message}`,
        timestamp: new Date().toISOString(),
        isError: true,
      };

      setConversations(prev => prev.map(c => {
        if (c.id !== activeConversationId) return c;
        return { ...c, messages: [...c.messages, errorMessage] };
      }));
    } finally {
      if ((settings.llmProvider || 'portfolio') !== 'portfolio') {
        setIsGenerating(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, conversations, isGenerating, selectedModel, settings, activeAgent, onPortfolioChat, speech]);

  const handleConfirmOption = useCallback(async (confirmationId, selectedOption) => {
    if (isConfirming) return;
    setIsConfirming(true);
    if (speech.isListening) speech.stopListening();

    const userChoiceMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: selectedOption,
      timestamp: new Date().toISOString(),
    };

    setConversations(prev => prev.map(c => {
      if (c.id !== activeConversationId) return c;
      return { ...c, messages: [...c.messages, userChoiceMessage] };
    }));

    try {
      const data = await confirmAction(confirmationId, selectedOption);

      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date().toISOString(),
        action: data.action || null,
      };

      setConversations(prev => prev.map(c => {
        if (c.id !== activeConversationId) return c;
        return { ...c, messages: [...c.messages, assistantMessage] };
      }));

      if (data.cancelled && (settings.ttsEnabled ?? true)) speech.speak('Action cancelled.');
      else if (data.action?.description && (settings.ttsEnabled ?? true)) speech.speak(data.action.description);
    } catch (err) {
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `**Error:** ${err.message}`,
        timestamp: new Date().toISOString(),
        isError: true,
      };

      setConversations(prev => prev.map(c => {
        if (c.id !== activeConversationId) return c;
        return { ...c, messages: [...c.messages, errorMessage] };
      }));
    } finally {
      setPendingConfirmation(null);
      setIsConfirming(false);
    }
  }, [activeConversationId, isConfirming, settings, speech]);

  handleConfirmRef.current = handleConfirmOption;

  const handleDismissConfirmation = useCallback(() => {
    setPendingConfirmation(null);
    if (speech.isListening) speech.stopListening();
  }, [speech]);

  sendMessageRef._send = sendMessage;

  const stopGeneration = useCallback(async () => {
    if (isAddonConnected) {
      try { await apiStopGeneration(); } catch {}
    }
    setIsGenerating(false);
  }, [isAddonConnected]);

  return (
    <div className="csimple-root" ref={rootRef}>
      <div className="csimple-app">
        <Sidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelectConversation={(id) => { setActiveConversationId(id); setSidebarOpen(false); setPendingConfirmation(null); }}
          onNewChat={createNewChat}
          onDeleteConversation={deleteConversation}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          settings={settings}
          onSettingsChange={setSettings}
          onOpenAdvancedSettings={() => setShowAdvancedSettings(true)}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          isOnline={isOnline}
          isAddonConnected={isAddonConnected}
          portfolioLLMProviders={portfolioLLMProviders}
        />

        <ChatWindow
          conversation={activeConversation}
          isGenerating={isGenerating}
          onSendMessage={sendMessage}
          onStopGeneration={stopGeneration}
          onToggleSidebar={() => setSidebarOpen(prev => !prev)}
          selectedModel={selectedModel}
          isOnline={isOnline}
          agent={activeAgent}
          speech={speech}
          sttEnabled={settings.sttEnabled ?? false}
          settings={settings}
          pendingConfirmation={pendingConfirmation}
          onConfirmOption={handleConfirmOption}
          onDismissConfirmation={handleDismissConfirmation}
          isConfirming={isConfirming}
          onTogglePassiveListening={() => {
            setSettings(prev => {
              const newVal = !prev.sttEnabled;
              saveDeviceLocalSetting('sttEnabled', newVal);
              return { ...prev, sttEnabled: newVal };
            });
          }}
        />

        <AdvancedSettings
          isOpen={showAdvancedSettings}
          onClose={() => setShowAdvancedSettings(false)}
          settings={settings}
          onSettingsChange={(newSettings) => {
            setSettings(newSettings);
            // Sync to addon if connected
            if (isAddonConnected) {
              const toSync = { ...newSettings };
              DEVICE_LOCAL_KEYS.forEach(k => delete toSync[k]);
              saveAddonSettings(toSync).catch(() => {});
            }
          }}
          isOnline={isOnline}
          speech={speech}
          micDevices={micDevices}
          user={user}
          cloudSyncStatus={cloudSyncStatus}
        />

        {isInactive && (
          <div className="csimple-inactive-overlay" onClick={resumeActivity}>
            <div className="csimple-inactive-overlay__content">
              <div className="csimple-inactive-overlay__icon">💤</div>
              <div className="csimple-inactive-overlay__title">Tab Paused</div>
              <div className="csimple-inactive-overlay__subtitle">
                Mic listening paused to save resources
              </div>
              <button className="csimple-inactive-overlay__btn" onClick={resumeActivity}>Click to Resume</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CSimpleChat;
