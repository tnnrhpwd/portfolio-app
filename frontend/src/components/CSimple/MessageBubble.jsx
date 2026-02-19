import React from 'react';
import ReactMarkdown from 'react-markdown';
import './MessageBubble.css';

// Only render data: or http(s): avatar URLs — drop stale /api/agents/... paths
const safeAvatarUrl = (url) =>
  url && (url.startsWith('data:') || url.startsWith('https://') || url.startsWith('http://')) ? url : null;

function MessageBubble({ message, agent, showTimestamp = true, enableMarkdown = true }) {
  const isUser = message.role === 'user';
  const hasAction = !isUser && message.action;
  const hasOperations = !isUser && message.operations?.length > 0;
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

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
                  <div key={i} className={`message__operation message__operation--${op.success ? 'success' : 'error'}`}>
                    <span className="message__operation-icon">
                      {op.type === 'memory_save' ? '🧠' : op.type === 'script_run' ? '▶️' : '📄'}
                    </span>
                    <span className="message__operation-label">
                      {op.type === 'memory_save' && `Saved memory: ${op.filename}`}
                      {op.type === 'file_create' && `Created file: ${op.filename}`}
                      {op.type === 'script_create' && `Created script: ${op.filename}`}
                      {op.type === 'script_run' && `Ran script: ${op.filename}${op.exitCode != null ? ` (exit ${op.exitCode})` : ''}`}
                    </span>
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
              <p className="message__text">{message.content}</p>
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
