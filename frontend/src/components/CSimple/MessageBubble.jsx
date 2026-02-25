import React from 'react';
import ReactMarkdown from 'react-markdown';
import { openFile, getAddonBaseUrl } from '../../services/csimpleApi';
import './MessageBubble.css';

// Only render data: or http(s): avatar URLs — drop stale /api/agents/... paths
const safeAvatarUrl = (url) =>
  url && (url.startsWith('data:') || url.startsWith('https://') || url.startsWith('http://')) ? url : null;

function MessageBubble({ message, agent, showTimestamp = true, enableMarkdown = true }) {
  const isUser = message.role === 'user';
  const hasAction = !isUser && message.action;
  const hasOperations = !isUser && message.operations?.length > 0;
  const hasFileDownload = !isUser && message.fileDownload;
  const hasAttachedFile = isUser && message.attachedFile;
  const msgDate = new Date(message.timestamp);
  const today = new Date();
  const isToday = msgDate.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = msgDate.toDateString() === yesterday.toDateString();

  const timeStr = msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = isToday
    ? timeStr
    : isYesterday
      ? `Yesterday, ${timeStr}`
      : `${msgDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  const time = dateStr;

  const handleDownload = () => {
    if (!message.fileDownload) return;
    const { data, filename, mimeType } = message.fileDownload;
    const byteArray = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const blob = new Blob([byteArray], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 100);
  };

  const handleOpenFile = async (op) => {
    // For file_save operations (from save_file tool), open via OS default viewer
    if (op.path) {
      try {
        await openFile(op.path);
      } catch (err) {
        console.error('Failed to open file:', err);
      }
      return;
    }
    // For file_create / script_create (from LLM blocks in workspace), open preview in browser
    const baseUrl = getAddonBaseUrl();
    if (baseUrl && op.filename) {
      window.open(`${baseUrl}/api/workspace/preview/${encodeURIComponent(op.filename)}`, '_blank');
    }
  };

  const isFileOperation = (type) => ['file_save', 'file_create', 'script_create'].includes(type);

  return (
    <div className={`message ${isUser ? 'message--user' : 'message--assistant'} ${message.isError ? 'message--error' : ''}`}>
      <div className="message__row">
        {!isUser && (
          safeAvatarUrl(agent?.avatarUrl) ? (
            <img className="message__avatar message__avatar--assistant-img" src={safeAvatarUrl(agent.avatarUrl)} alt={agent.name} />
          ) : (
            <div className="message__avatar message__avatar--assistant">{(agent?.name || 'C')[0]}</div>
          )
        )}

        <div className="message__content">
          <div className={`message__bubble ${isUser ? 'message__bubble--user' : 'message__bubble--assistant'} ${hasAction ? 'message__bubble--action' : ''}`}>
            {hasAction && (
              <div className="message__action-badge">
                <span className="message__action-icon">⚡</span>
                <span>Action Executed</span>
              </div>
            )}
            {hasOperations && (
              <div className="message__operations">
                {message.operations.map((op, i) => (
                  <div key={i} className={`message__operation message__operation--${op.success !== false ? 'success' : 'error'}`}>
                    <span className="message__operation-icon">
                      {op.type === 'memory_save' ? '🧠' : op.type === 'file_save' ? '💾' : op.type === 'script_run' ? '▶️' : '📄'}
                    </span>
                    {isFileOperation(op.type) ? (
                      <span
                        className="message__operation-label message__operation-link"
                        onClick={() => handleOpenFile(op)}
                        title={op.path || `Click to view ${op.filename}`}
                      >
                        {op.type === 'file_save' && `Saved: ${op.filename}`}
                        {op.type === 'file_create' && `Created: ${op.filename}`}
                        {op.type === 'script_create' && `Script: ${op.filename}`}
                        <span className="message__operation-open-hint">↗ Open</span>
                      </span>
                    ) : (
                      <span className="message__operation-label">
                        {op.type === 'memory_save' && `Saved memory: ${op.filename}`}
                        {op.type === 'script_run' && `Ran script: ${op.filename}${op.exitCode != null ? ` (exit ${op.exitCode})` : ''}`}
                      </span>
                    )}
                    {op.type === 'script_run' && op.stdout && (
                      <pre className="message__operation-output">{op.stdout}</pre>
                    )}
                    {op.type === 'script_run' && op.stderr && (
                      <pre className="message__operation-output message__operation-output--error">{op.stderr}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}
            {isUser ? (
              <>
                {hasAttachedFile && (
                  <div className="message__attached-file">
                    <span className="message__attached-file-icon">📎</span>
                    <span className="message__attached-file-name">{message.attachedFile.name}</span>
                  </div>
                )}
                <p className="message__text">{message.content}</p>
              </>
            ) : enableMarkdown ? (
              <div className="message__markdown">
                <ReactMarkdown
                  components={{
                    code({ node, inline, className, children, ...props }) {
                      return inline ? (
                        <code className="message__inline-code" {...props}>{children}</code>
                      ) : (
                        <pre className="message__code-block">
                          <code className={className} {...props}>{children}</code>
                        </pre>
                      );
                    },
                    a({ href, children }) {
                      return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
                    },
                  }}
                >
                  {message.content}
                </ReactMarkdown>
                {hasFileDownload && (
                  <button className="message__download-btn" onClick={handleDownload}>
                    <span className="message__download-icon">⬇️</span>
                    <span>Download {message.fileDownload.filename}</span>
                  </button>
                )}
              </div>
            ) : (
              <p className="message__text">{message.content}</p>
            )}
          </div>

          <div className="message__meta">
            {showTimestamp && <span className="message__time">{time}</span>}
            {message.generationTime && (
              <span className="message__gen-time">⚡ {message.generationTime}</span>
            )}
            {message.tokenUsage && (
              <span className="message__tokens" title={`Prompt: ${message.tokenUsage.prompt_tokens} | Completion: ${message.tokenUsage.completion_tokens}`}>
                🔤 {message.tokenUsage.total_tokens} tok
              </span>
            )}
            {message.modelId && (
              <span className="message__model">{message.modelId.split('/').pop()}</span>
            )}
          </div>
        </div>

        {isUser && (
          <div className="message__avatar message__avatar--user">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

export default MessageBubble;
