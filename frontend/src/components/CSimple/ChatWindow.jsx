import React, { useState, useRef, useEffect, useCallback } from 'react';
import MessageBubble from './MessageBubble';
import ConfirmationPanel from './ConfirmationPanel';
import './ChatWindow.css';

// Only allow data: and https: avatar URLs — drop stale /api/agents/... paths
const safeAvatarUrl = (url) =>
  url && (url.startsWith('data:') || url.startsWith('https://') || url.startsWith('http://')) ? url : null;

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff', 'image/avif', 'image/bmp'];

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function ChatWindow({ conversation, isGenerating, onSendMessage, onStopGeneration, onToggleSidebar, selectedModel, isOnline, agent, speech, sttEnabled, settings, pendingConfirmation, onConfirmOption, onDismissConfirmation, isConfirming, onTogglePassiveListening }) {
  const [input, setInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const messagesContainerRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragCounter = useRef(0);

  // Auto-scroll to bottom on new messages (scoped to the messages box, not the page)
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation?.messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  // ── File handling ─────────────────────────────────────────────────────────
  const validateAndAddFiles = useCallback((fileList) => {
    const newFiles = [];
    for (const file of fileList) {
      if (file.size > MAX_FILE_SIZE) {
        alert(`${file.name} is too large (max 25 MB)`);
        continue;
      }
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        alert(`${file.name} is not a supported image type.\nSupported: JPG, PNG, WEBP, GIF, TIFF, AVIF`);
        continue;
      }
      // Avoid duplicates by name
      if (!attachedFiles.some(f => f.name === file.name && f.size === file.size)) {
        newFiles.push(file);
      }
    }
    if (newFiles.length > 0) {
      setAttachedFiles(prev => [...prev, ...newFiles].slice(0, 1)); // single file for now
    }
  }, [attachedFiles]);

  const removeFile = useCallback((index) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setDragActive(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragActive(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    dragCounter.current = 0;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndAddFiles(e.dataTransfer.files);
      e.dataTransfer.clearData();
    }
  }, [validateAndAddFiles]);

  const handleFileInputChange = useCallback((e) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndAddFiles(e.target.files);
      e.target.value = ''; // reset so the same file can be re-selected
    }
  }, [validateAndAddFiles]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = (e) => {
    e.preventDefault();
    const hasText = input.trim().length > 0;
    const hasFiles = attachedFiles.length > 0;
    if ((!hasText && !hasFiles) || isGenerating) return;
    onSendMessage(input.trim(), attachedFiles);
    setInput('');
    setAttachedFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const toggleListening = () => {
    if (!speech) return;
    if (speech.isListening) {
      speech.stopListening();
    } else {
      speech.startListening((text) => {
        if (text.trim()) {
          onSendMessage(text.trim());
        }
      });
    }
  };

  const handleKeyDown = (e) => {
    const sendWithEnter = settings?.sendWithEnter ?? true;
    if (e.key === 'Enter' && !e.shiftKey && sendWithEnter) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const messages = conversation?.messages || [];

  return (
    <main className="chat-window">
      {/* Header */}
      <header className="chat-window__header">
        <button className="chat-window__menu-btn" onClick={onToggleSidebar} title="Toggle sidebar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="chat-window__header-info">
          <h1 className="chat-window__title">{conversation?.title || 'New Chat'}</h1>
          <span className="chat-window__model-badge">
            {settings?.llmProvider === 'github'
              ? (settings.githubModel || 'gpt-4o-mini')
              : selectedModel.split('/').pop()}
          </span>
        </div>
        <div className="chat-window__header-spacer" />
        <div className={`chat-window__status-badge ${isOnline ? 'chat-window__status-badge--online' : 'chat-window__status-badge--offline'}`}>
          <span className="chat-window__status-indicator">{isOnline ? '🟢' : '⚫'}</span>
          <span className="chat-window__status-text">{isOnline ? 'Online' : 'Offline'}</span>
        </div>
        <button
          className={`chat-window__passive-toggle ${sttEnabled ? 'chat-window__passive-toggle--active' : 'chat-window__passive-toggle--inactive'}`}
          onClick={onTogglePassiveListening}
          title={sttEnabled ? 'Passive listening is ON — click to disable' : 'Passive listening is OFF — click to enable'}
        >
          {sttEnabled ? '🟢' : '⚫'} Passive Listening
        </button>
      </header>

      {/* Passive hint — shows when speech was heard but no wake word */}
      {speech?.passiveHeard && !speech?.isListening && (
        <div className="chat-window__passive-hint">
          Heard: “{speech.passiveHeard}” — say <strong>“{agent?.name || 'agent name'}”</strong> first to activate
        </div>
      )}

      {/* Listening Banner */}
      {speech?.isListening && (
        <div className="chat-window__listening-banner">
          <div className="chat-window__listening-waves">
            <span /><span /><span /><span /><span />
          </div>
          <div className="chat-window__listening-info">
            <span className="chat-window__listening-label">🎙 Listening...</span>
            <div className="chat-window__mic-level" title={`Level: ${((speech.micLevel || 0) * 100).toFixed(0)}%`}>
              <div
                className={`chat-window__mic-level-bar${(speech.micLevel || 0) > 0.02 ? ' chat-window__mic-level-bar--active' : ''}`}
                style={{ width: `${Math.min((speech.micLevel || 0) * 500, 100)}%` }}
              />
            </div>
            {speech.transcript && (
              <span className="chat-window__listening-transcript">&quot;{speech.transcript}&quot;</span>
            )}
          </div>
          <button
            className="chat-window__listening-stop"
            onClick={() => speech.stopListening()}
            title="Stop listening"
          >
            Stop
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="chat-window__messages" ref={messagesContainerRef}>
        {messages.length === 0 && (
          <div className="chat-window__empty">
            <div className="chat-window__empty-icon">
              {safeAvatarUrl(agent?.avatarUrl) ? (
                <img className="chat-window__empty-avatar-img" src={safeAvatarUrl(agent.avatarUrl)} alt="" />
              ) : (
                <img className="chat-window__empty-logo" src="/csimple_logo.png" alt="C-Simple" />
              )}
            </div>
            <h2>{agent?.name || 'C-Simple AI'} Chat</h2>
            <p>Send a message to start chatting with your local AI model.</p>
            <p className="chat-window__empty-hint">📎 Drop an image to convert, resize, or compress it</p>
            <div className="chat-window__suggestions">
              {[
                'Explain how neural networks work',
                'Write a Python script to sort a list',
                'What are the benefits of local AI?',
                'Help me debug my code',
              ].map((suggestion, i) => (
                <button
                  key={i}
                  className="chat-window__suggestion"
                  onClick={() => onSendMessage(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            agent={agent}
            showTimestamp={settings?.showTimestamps ?? true}
            enableMarkdown={settings?.enableMarkdown ?? true}
          />
        ))}

        {isGenerating && (
          <div className="chat-window__typing">
            {safeAvatarUrl(agent?.avatarUrl) ? (
              <img className="chat-window__typing-avatar-img" src={safeAvatarUrl(agent.avatarUrl)} alt="" />
            ) : (
              <div className="chat-window__typing-avatar">{(agent?.name || 'C')[0]}</div>
            )}
            <div className="chat-window__typing-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        <div aria-hidden="true" />
      </div>

      {/* Input */}
      <form
        className={`chat-window__input-form ${dragActive ? 'chat-window__input-form--drag-active' : ''}`}
        onSubmit={handleSubmit}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {dragActive && (
          <div className="chat-window__drop-overlay">
            <div className="chat-window__drop-overlay-content">
              <span className="chat-window__drop-icon">📎</span>
              <span>Drop file here</span>
            </div>
          </div>
        )}

        {/* Confirmation Panel — slides up when the AI needs user confirmation */}
        <ConfirmationPanel
          confirmation={pendingConfirmation}
          onSelectOption={onConfirmOption}
          onDismiss={onDismissConfirmation}
          isLoading={isConfirming}
        />
        {speech?.isListening && (
          <div className="chat-window__listening-bar">
            <span className="chat-window__listening-pulse" />
            <span>Listening{speech.transcript ? `: "${speech.transcript}"` : '...'}</span>
          </div>
        )}

        {/* Attached file chips */}
        {attachedFiles.length > 0 && (
          <div className="chat-window__file-chips">
            {attachedFiles.map((file, idx) => (
              <div key={`${file.name}-${idx}`} className="chat-window__file-chip">
                <span className="chat-window__file-chip-icon">
                  {file.type.startsWith('image/') ? '🖼️' : '📄'}
                </span>
                <span className="chat-window__file-chip-name">{file.name}</span>
                <span className="chat-window__file-chip-size">{formatFileSize(file.size)}</span>
                <button
                  type="button"
                  className="chat-window__file-chip-remove"
                  onClick={() => removeFile(idx)}
                  title="Remove file"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="chat-window__input-wrapper">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileInputChange}
            style={{ display: 'none' }}
          />
          {/* Attach file button */}
          <button
            type="button"
            className="chat-window__attach-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Attach an image file"
          >
            File
          </button>
          <textarea
            ref={textareaRef}
            className="chat-window__input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={attachedFiles.length > 0 ? 'Describe what to do with the file (e.g. "convert to jpg")...' : isOnline ? "Type a message..." : "Offline - Cannot send messages"}
            rows={1}
            disabled={isGenerating || !isOnline}
          />
          {sttEnabled && speech?.sttSupported && (
            <button
              type="button"
              className={`chat-window__mic-btn ${speech.isListening ? 'chat-window__mic-btn--active' : ''}`}
              onClick={toggleListening}
              title={speech.isListening ? 'Stop listening' : 'Voice input'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
          )}
          {isGenerating ? (
            <button
              type="button"
              className="chat-window__stop-btn"
              onClick={onStopGeneration}
              title="Stop generation"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              className="chat-window__send-btn"
              disabled={(!input.trim() && attachedFiles.length === 0) || !isOnline}
              title={isOnline ? "Send message" : "Cannot send while offline"}
            >
              Send
            </button>
          )}
        </div>
        <div className="chat-window__input-hint">
          {(settings?.sendWithEnter ?? true)
            ? 'Press Enter to send, Shift+Enter for new line'
            : 'Press Shift+Enter to send, Enter for new line'
          }{sttEnabled && speech?.sttSupported ? ` · Click 🎤 or say "${agent?.name || 'agent'}"` : ''}
        </div>
      </form>
    </main>
  );
}

export default ChatWindow;
