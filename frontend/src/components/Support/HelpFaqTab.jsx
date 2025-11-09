import React from 'react';

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
                <div 
                  dangerouslySetInnerHTML={{ __html: faq.answer }}
                  className="support-faq-answer-text"
                />
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
