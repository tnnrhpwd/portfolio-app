import React from 'react';
import ReactMarkdown from 'react-markdown';
import './MessageBubble.css';

function MessageBubble({ message, agent, showTimestamp = true, enableMarkdown = true }) {
  const isUser = message.role === 'user';
  const hasAction = !isUser && message.action;
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={`message ${isUser ? 'message--user' : 'message--assistant'} ${message.isError ? 'message--error' : ''}`}>
      <div className="message__row">
        {!isUser && (
          agent?.avatarUrl ? (
            <img className="message__avatar message__avatar--assistant-img" src={agent.avatarUrl} alt={agent.name} />
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
