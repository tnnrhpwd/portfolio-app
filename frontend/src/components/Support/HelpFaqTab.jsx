import React from 'react';

/**
 * Render FAQ answer text as plain text with safe <a> links. The FAQ data is
 * static/developer-controlled, but this avoids `dangerouslySetInnerHTML`
 * entirely so the component can never execute injected HTML.
 */
const FAQ_LINK_RE = /<a\s+href=['"]([^'"]+)['"]>(.*?)<\/a>/gi;

function renderFaqAnswer(answer) {
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = FAQ_LINK_RE.exec(answer)) !== null) {
    if (match.index > lastIndex) parts.push(answer.slice(lastIndex, match.index));
    parts.push(
      <a key={match.index} href={match[1]} rel="noopener noreferrer">
        {match[2]}
      </a>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < answer.length) parts.push(answer.slice(lastIndex));
  return parts;
}

/**
 * Help & FAQ Tab Component
 */
const HelpFaqTab = ({ faqData, searchQuery, setSearchQuery, expandedFaq, handleFaqToggle }) => {
  const filteredFaqs = faqData.filter(faq =>
    faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
    faq.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
    faq.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="support-help-section">
      <div className="support-search-container">
        <input
          type="text"
          placeholder="🔍 Search FAQ..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="support-search-input"
        />
      </div>
      
      <div className="support-faq-list">
        {filteredFaqs.map(faq => (
          <div key={faq.id} className="support-faq-item">
            <button
              className="support-faq-question"
              onClick={() => handleFaqToggle(faq.id)}
            >
              <span>{faq.question}</span>
              <span className={`support-faq-arrow ${expandedFaq === faq.id ? 'expanded' : ''}`}>
                ▼
              </span>
            </button>
            {expandedFaq === faq.id && (
              <div className="support-faq-answer">
                <div className="support-faq-answer-text">
                  {renderFaqAnswer(faq.answer)}
                </div>
                <span className="support-faq-category">Category: {faq.category}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredFaqs.length === 0 && (
        <div className="support-no-results">
          <p>🔍 No FAQ items match your search. Try different keywords or contact us directly!</p>
        </div>
      )}
    </div>
  );
};

export default HelpFaqTab;
