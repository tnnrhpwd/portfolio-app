import React from 'react';

/**
 * Contact Tab Component
 */
const ContactTab = ({ formData, handleInputChange, handleContactSubmit, isSubmitting }) => {
  return (
    <div className="support-form-section">
      <h2>💬 Get in Touch</h2>
      <p className="support-form-description">
        Need personalized help? Send us a message and we'll get back to you as soon as possible.
      </p>

      <form onSubmit={handleContactSubmit} className="support-form">
        <div className="support-form-row">
          <div className="support-form-group">
            <label htmlFor="contactName">Your Name *</label>
            <input
              type="text"
              id="contactName"
              name="contactName"
              value={formData.contactName}
              onChange={handleInputChange}
              placeholder="Full name"
              required
            />
          </div>
          <div className="support-form-group">
            <label htmlFor="contactEmail">Email Address *</label>
            <input
              type="email"
              id="contactEmail"
              name="contactEmail"
              value={formData.contactEmail}
              onChange={handleInputChange}
              placeholder="your@email.com"
              required
            />
          </div>
        </div>

        <div className="support-form-row">
          <div className="support-form-group">
            <label htmlFor="contactType">Inquiry Type</label>
            <select
              id="contactType"
              name="contactType"
              value={formData.contactType}
              onChange={handleInputChange}
            >
              <option value="support">General Support</option>
              <option value="technical">Technical Issue</option>
              <option value="billing">Billing Question</option>
              <option value="feature">Feature Request</option>
              <option value="partnership">Partnership</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="support-form-group">
            <label htmlFor="contactPriority">Priority</label>
            <select
              id="contactPriority"
              name="contactPriority"
              value={formData.contactPriority}
              onChange={handleInputChange}
            >
              <option value="low">Low - General Question</option>
              <option value="medium">Medium - Need Help</option>
              <option value="high">High - Urgent Issue</option>
              <option value="critical">Critical - Service Down</option>
            </select>
          </div>
        </div>

        <div className="support-form-group">
          <label htmlFor="contactSubject">Subject *</label>
          <input
            type="text"
            id="contactSubject"
            name="contactSubject"
            value={formData.contactSubject}
            onChange={handleInputChange}
            placeholder="Brief description of your inquiry"
            required
            maxLength={150}
          />
        </div>

        <div className="support-form-group">
          <label htmlFor="contactMessage">Message *</label>
          <textarea
            id="contactMessage"
            name="contactMessage"
            value={formData.contactMessage}
            onChange={handleInputChange}
            placeholder="Please provide as much detail as possible..."
            required
            rows="8"
            maxLength={2000}
          />
          <small className="support-char-count">
            {formData.contactMessage.length}/2000 characters
          </small>
        </div>

        <div className="support-contact-info">
          <h4>Alternative Contact Methods:</h4>
          <p>📧 Email: <a href="mailto:Admin@STHopwood.com">Admin@STHopwood.com</a></p>
          <p>🕒 Response Time: Within 24 hours (1-2 hours for critical issues)</p>
        </div>

        <button
          type="submit"
          className="support-submit-btn"
          disabled={isSubmitting || !formData.contactName.trim() || !formData.contactEmail.trim() || !formData.contactSubject.trim() || !formData.contactMessage.trim()}
        >
          {isSubmitting ? '📤 Sending...' : '💬 Send Message'}
        </button>
      </form>
    </div>
  );
};

export default ContactTab;
