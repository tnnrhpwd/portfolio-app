import { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import { createData } from '../../features/data/dataSlice';
import Spinner from '../../components/Spinner/Spinner.jsx';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import './Support.css';

function Support() {
  const dispatch = useDispatch();
  
  const { user, dataIsLoading } = useSelector((state) => state.data);

  const [activeTab, setActiveTab] = useState('help');
  const [formData, setFormData] = useState({
    // Review Submission Form
    reviewTitle: '',
    reviewContent: '',
    reviewRating: 5,
    reviewCategory: 'general',
    
    // Contact Form
    contactName: '',
    contactEmail: '',
    contactSubject: '',
    contactMessage: '',
    contactPriority: 'medium',
    contactType: 'support',
    
    // Bug Report Form
    bugTitle: '',
    bugDescription: '',
    bugSteps: '',
    bugExpected: '',
    bugActual: '',
    bugSeverity: 'medium',
    bugBrowser: '',
    bugDevice: ''
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFaq, setExpandedFaq] = useState(null);
  const [userBugReports, setUserBugReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [hoverRating, setHoverRating] = useState(0);

  // FAQ Data with enhanced answers containing hyperlinks
  const faqData = [
    {
      id: 1,
      question: "How do I create a new account?",
      answer: "Click the 'Register' button on the <a href='/login'>login page</a> and fill out the required information. You'll receive a confirmation email to activate your account.",
      category: "account"
    },
    {
      id: 2,
      question: "How do I reset my password?",
      answer: "On the <a href='/login'>login page</a>, click 'Forgot Password' and enter your email address. We'll send you a reset link within a few minutes.",
      category: "account"
    },
    {
      id: 3,
      question: "How do I link my social media accounts?",
      answer: "Go to <a href='/settings'>Settings</a> > Authentication & Account Linking. Click 'Link Account' for any supported provider (Google, Facebook, etc.) and follow the authentication flow.",
      category: "account"
    },
    {
      id: 4,
      question: "What data do you collect?",
      answer: "We only collect data necessary to provide our services. See our <a href='/privacy'>Privacy Policy</a> for detailed information about data collection, storage, and usage.",
      category: "privacy"
    },
    {
      id: 5,
      question: "How do I delete my account?",
      answer: "Go to <a href='/settings'>Settings</a> and scroll to the bottom. Click 'Delete Account' and confirm. Note that this action is irreversible.",
      category: "account"
    },
    {
      id: 6,
      question: "Why is the app running slowly?",
      answer: "Try clearing your browser cache, updating your browser, or checking your internet connection. If issues persist, report a bug using our <a href='#bug' onclick='setActiveTab(\"bug\")'>support form</a>.",
      category: "technical"
    },
    {
      id: 7,
      question: "How do I contact support?",
      answer: "Use the <a href='#contact' onclick='setActiveTab(\"contact\")'>Contact Us</a> tab on this page, email us directly, or check our FAQ section for common questions.",
      category: "support"
    },
    {
      id: 8,
      question: "What browsers are supported?",
      answer: "We support the latest versions of Chrome, Firefox, Safari, and Edge. For the best experience, keep your browser updated.",
      category: "technical"
    },
    {
      id: 9,
      question: "How do I access my profile?",
      answer: "Click on your name in the navigation menu or go directly to your <a href='/profile'>Profile</a> page to view and edit your account information.",
      category: "account"
    },
    {
      id: 10,
      question: "Where can I learn more about the app?",
      answer: "Visit our <a href='/about'>About</a> page to learn more about our services, or explore our various tools like <a href='/wordle'>Wordle</a>, <a href='/passgen'>Password Generator</a>, and <a href='/annuities'>Annuities Calculator</a>.",
      category: "general"
    },
    {
      id: 11,
      question: "How do I view terms and conditions?",
      answer: "You can read our full <a href='/terms'>Terms of Service</a> and <a href='/privacy'>Privacy Policy</a> at any time.",
      category: "legal"
    },
    {
      id: 12,
      question: "What should I do if I found a bug?",
      answer: "Please use our <a href='#bug' onclick='setActiveTab(\"bug\")'>Bug Report</a> form to describe the issue in detail. This helps us fix problems quickly and improve the app for everyone.",
      category: "technical"
    }
  ];

  // Quick Actions
  const quickActions = [
    {
      id: 'faq',
      title: 'Browse FAQ',
      description: 'Find answers to common questions',
      icon: '❓',
      action: () => setActiveTab('help')
    },
    {
      id: 'contact',
      title: 'Contact Support',
      description: 'Get personalized help from our team',
      icon: '💬',
      action: () => setActiveTab('contact')
    },
    {
      id: 'review',
      title: 'Leave a Review',
      description: 'Share your experience with our app',
      icon: '⭐',
      action: () => setActiveTab('review')
    },
    {
      id: 'reports',
      title: 'My Bug Reports',
      description: 'View and manage your submitted reports',
      icon: '📋',
      action: () => {
        setActiveTab('reports');
        fetchUserBugReports();
      }
    },
    {
      id: 'bug',
      title: 'Report a Bug',
      description: 'Help us improve by reporting issues',
      icon: '🐛',
      action: () => setActiveTab('bug')
    }
  ];

  useEffect(() => {
    // Auto-detect browser and device for bug reports
    if (typeof window !== 'undefined') {
      const browserInfo = getBrowserInfo();
      const deviceInfo = getDeviceInfo();
      
      setFormData(prev => ({
        ...prev,
        bugBrowser: browserInfo,
        bugDevice: deviceInfo,
        contactEmail: user?.email || ''
      }));

      // Make setActiveTab globally available for FAQ links
      window.setActiveTab = (tab) => {
        setActiveTab(tab);
      };
    }

    // Cleanup function
    return () => {
      if (typeof window !== 'undefined') {
        delete window.setActiveTab;
      }
    };
  }, [user]);

  const getBrowserInfo = () => {
    const userAgent = navigator.userAgent;
    let browser = 'Unknown';
    
    if (userAgent.includes('Chrome')) browser = 'Chrome';
    else if (userAgent.includes('Firefox')) browser = 'Firefox';
    else if (userAgent.includes('Safari')) browser = 'Safari';
    else if (userAgent.includes('Edge')) browser = 'Edge';
    
    return `${browser} (${userAgent})`;
  };

  const getDeviceInfo = () => {
    const { screen, navigator } = window;
    return `${navigator.platform} - ${screen.width}x${screen.height} - ${navigator.language}`;
  };

  const handleInputChange = (e) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? parseInt(value) : value
    }));
  };

  const handleStarClick = (rating) => {
    setFormData(prev => ({
      ...prev,
      reviewRating: rating
    }));
  };

  const getUserIdentifier = () => {
    if (!user) return 'Anonymous';
    
    // Check for direct email property first (most likely in frontend user object)
    if (user.email) return user.email;
    
    // Check for email in the text field (backend format)
    if (user.text && user.text.includes('Email:')) {
      const emailMatch = user.text.match(/Email:([^|]+)/);
      if (emailMatch) return emailMatch[1];
    }
    
    // Fallback to other identifiers
    return user.id || user.nickname || 'Anonymous';
  };

  const fetchUserBugReports = async () => {
    // Check for user authentication using the available user properties
    if (!user || !user.id) {
      toast.error('Please log in to view your bug reports.', { autoClose: 3000 });
      return;
    }
    
    setLoadingReports(true);
    try {
      // Since the backend doesn't have a specific endpoint for user bug reports,
      // we'll need to get user data and filter client-side
      // For now, we'll use a placeholder until we can implement proper backend filtering
      
      // Mock data for demonstration - in production, you'd query the backend for user's bug reports
      const mockReports = [
        {
          id: 'mock-1',
          title: 'Button not responding on mobile',
          severity: 'medium',
          description: 'The submit button on forms doesn\'t work on mobile devices.',
          steps: '1. Open app on mobile\n2. Fill out any form\n3. Try to submit\n4. Nothing happens',
          expected: 'Form should submit successfully',
          actual: 'Button appears unresponsive, no feedback given',
          browser: 'Mobile Safari iOS 16.2',
          device: 'iPhone 14 Pro',
          status: 'Open',
          createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
          updatedAt: new Date(Date.now() - 86400000).toISOString(),
          timestamp: new Date(Date.now() - 86400000).toISOString()
        }
      ];

      // TODO: Replace with actual backend call once implemented
      // const response = await dispatch(getUserBugReports({ userId: user.id })).unwrap();
      
      setUserBugReports(mockReports);
      
    } catch (error) {
      console.error('Error fetching bug reports:', error);
      toast.error('Failed to load your bug reports.', { autoClose: 3000 });
      setUserBugReports([]);
    } finally {
      setLoadingReports(false);
    }
  };

  const closeBugReport = async (reportId) => {
    try {
      setIsSubmitting(true);
      
      // Mock the close functionality for demonstration
      // TODO: Replace with actual backend call once implemented
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Update the local state to show the report as closed
      setUserBugReports(prevReports => 
        prevReports.map(report => 
          report.id === reportId 
            ? { ...report, status: 'Closed', updatedAt: new Date().toISOString() }
            : report
        )
      );
      
      toast.success('Bug report marked as resolved!', { autoClose: 4000 });
      
    } catch (error) {
      console.error('Error closing bug report:', error);
      toast.error('Failed to close bug report. Please try again.', { autoClose: 3000 });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const reviewData = {
        text: `Review:${formData.reviewTitle}|Category:${formData.reviewCategory}|Rating:${formData.reviewRating}/5|Content:${formData.reviewContent}|User:${user?.email || 'Anonymous'}|Timestamp:${new Date().toISOString()}`
      };

      await dispatch(createData(reviewData)).unwrap();
      
      toast.success('Thank you for your review! We appreciate your feedback.', { autoClose: 4000 });
      
      // Reset form
      setFormData(prev => ({
        ...prev,
        reviewTitle: '',
        reviewContent: '',
        reviewRating: 5,
        reviewCategory: 'general'
      }));
      
    } catch (error) {
      console.error('Error submitting review:', error);
      toast.error('Failed to submit review. Please try again.', { autoClose: 3000 });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleContactSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const contactData = {
        text: `Contact:${formData.contactSubject}|Type:${formData.contactType}|Priority:${formData.contactPriority}|Name:${formData.contactName}|Email:${formData.contactEmail}|Message:${formData.contactMessage}|Timestamp:${new Date().toISOString()}`
      };

      await dispatch(createData(contactData)).unwrap();
      
      toast.success('Message sent successfully! We\'ll get back to you soon.', { autoClose: 4000 });
      
      // Reset form
      setFormData(prev => ({
        ...prev,
        contactName: '',
        contactSubject: '',
        contactMessage: '',
        contactPriority: 'medium',
        contactType: 'support'
      }));
      
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message. Please try again.', { autoClose: 3000 });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBugReportSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Enhanced bug report data with structured format including Creator, Status, and all form fields
      const userId = getUserIdentifier();
      const bugData = {
        text: `Bug:${formData.bugTitle}|Severity:${formData.bugSeverity}|Description:${formData.bugDescription}|Steps:${formData.bugSteps}|Expected:${formData.bugExpected}|Actual:${formData.bugActual}|Browser:${formData.bugBrowser}|Device:${formData.bugDevice}|Creator:${userId}|Status:Open|Timestamp:${new Date().toISOString()}`
      };

      await dispatch(createData(bugData)).unwrap();
      
      toast.success('Bug report submitted! Thank you for helping us improve.', { autoClose: 4000 });
      
      // Reset form
      setFormData(prev => ({
        ...prev,
        bugTitle: '',
        bugDescription: '',
        bugSteps: '',
        bugExpected: '',
        bugActual: '',
        bugSeverity: 'medium'
      }));

      // Refresh bug reports if user is on reports tab
      if (activeTab === 'reports') {
        fetchUserBugReports();
      }
      
    } catch (error) {
      console.error('Error submitting bug report:', error);
      toast.error('Failed to submit bug report. Please try again.', { autoClose: 3000 });
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredFaqs = faqData.filter(faq =>
    faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
    faq.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
    faq.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleFaqToggle = (faqId) => {
    setExpandedFaq(expandedFaq === faqId ? null : faqId);
  };

  if (dataIsLoading) {
    return <Spinner />;
  }

  return (
    <>
      <Header />
      <div className="support-bg">
        <div className="support-container">
          <div className="support-header">
            <h1 className="support-title">🛟 Support Center</h1>
            <p className="support-subtitle">
              We're here to help! Find answers, report issues, or get in touch with our team.
            </p>
          </div>

          {/* Quick Actions */}
          <div className="support-quick-actions">
            <h2 className="support-section-title">Quick Actions</h2>
            <div className="support-actions-grid">
              {quickActions.map(action => (
                <button
                  key={action.id}
                  className="support-action-card"
                  onClick={action.action}
                >
                  <div className="support-action-icon">{action.icon}</div>
                  <div className="support-action-content">
                    <h3>{action.title}</h3>
                    <p>{action.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="support-tabs">
            <button
              className={`support-tab ${activeTab === 'help' ? 'active' : ''}`}
              onClick={() => setActiveTab('help')}
            >
              ❓ Help & FAQ
            </button>
            <button
              className={`support-tab ${activeTab === 'review' ? 'active' : ''}`}
              onClick={() => setActiveTab('review')}
            >
              ⭐ Leave Review
            </button>
            <button
              className={`support-tab ${activeTab === 'contact' ? 'active' : ''}`}
              onClick={() => setActiveTab('contact')}
            >
              💬 Contact Us
            </button>
            {user && (
              <button
                className={`support-tab ${activeTab === 'reports' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('reports');
                  fetchUserBugReports();
                }}
              >
                📋 My Reports
              </button>
            )}
            <button
              className={`support-tab ${activeTab === 'bug' ? 'active' : ''}`}
              onClick={() => setActiveTab('bug')}
            >
              🐛 Report Bug
            </button>
          </div>

          {/* Tab Content */}
          <div className="support-content">
            
            {/* Help & FAQ Tab */}
            {activeTab === 'help' && (
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
            )}

            {/* Review Tab */}
            {activeTab === 'review' && (
              <div className="support-form-section">
                <h2>⭐ Share Your Experience</h2>
                <p className="support-form-description">
                  Your feedback helps us improve! Share your thoughts about our application.
                </p>
                
                <form onSubmit={handleReviewSubmit} className="support-form">
                  <div className="support-form-row">
                    <div className="support-form-group">
                      <label htmlFor="reviewTitle">Review Title *</label>
                      <input
                        type="text"
                        id="reviewTitle"
                        name="reviewTitle"
                        value={formData.reviewTitle}
                        onChange={handleInputChange}
                        placeholder="Brief title for your review"
                        required
                        maxLength={100}
                      />
                    </div>
                    <div className="support-form-group">
                      <label htmlFor="reviewCategory">Category</label>
                      <select
                        id="reviewCategory"
                        name="reviewCategory"
                        value={formData.reviewCategory}
                        onChange={handleInputChange}
                      >
                        <option value="general">General Experience</option>
                        <option value="usability">Usability</option>
                        <option value="performance">Performance</option>
                        <option value="features">Features</option>
                        <option value="design">Design</option>
                        <option value="support">Customer Support</option>
                      </select>
                    </div>
                  </div>

                  <div className="support-form-group">
                    <label htmlFor="reviewRating">Rating</label>
                    <div className="support-rating-container">
                      <div className="support-rating-stars">
                        {[...Array(5)].map((_, i) => (
                          <span
                            key={i}
                            className={`support-star clickable ${
                              i < (hoverRating || formData.reviewRating) ? 'filled' : ''
                            }`}
                            onClick={() => handleStarClick(i + 1)}
                            onMouseEnter={() => setHoverRating(i + 1)}
                            onMouseLeave={() => setHoverRating(0)}
                          >
                            ⭐
                          </span>
                        ))}
                        <span className="support-rating-text">({formData.reviewRating}/5)</span>
                      </div>
                    </div>
                  </div>

                  <div className="support-form-group">
                    <label htmlFor="reviewContent">Your Review *</label>
                    <textarea
                      id="reviewContent"
                      name="reviewContent"
                      value={formData.reviewContent}
                      onChange={handleInputChange}
                      placeholder="Tell us about your experience with our application..."
                      required
                      rows="6"
                      maxLength={1000}
                    />
                    <small className="support-char-count">
                      {formData.reviewContent.length}/1000 characters
                    </small>
                  </div>

                  <button
                    type="submit"
                    className="support-submit-btn"
                    disabled={isSubmitting || !formData.reviewTitle.trim() || !formData.reviewContent.trim()}
                  >
                    {isSubmitting ? '📤 Submitting...' : '⭐ Submit Review'}
                  </button>
                </form>
              </div>
            )}

            {/* Contact Tab */}
            {activeTab === 'contact' && (
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
                    <p>📧 Email: <a href="mailto:support@yourapp.com">support@yourapp.com</a></p>
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
            )}

            {/* My Bug Reports Tab */}
            {activeTab === 'reports' && user && (
              <div className="support-form-section">
                <h2>📋 My Bug Reports</h2>
                
                <p className="support-form-description">
                  View and manage your submitted bug reports. You can close reports that have been resolved.
                </p>

                {loadingReports ? (
                  <div className="support-loading">
                    <Spinner />
                    <p>Loading your bug reports...</p>
                  </div>
                ) : userBugReports.length === 0 ? (
                  <div className="support-no-reports">
                    <div className="support-no-reports-icon">🐛</div>
                    <p>You haven't submitted any bug reports yet.</p>
                    <button
                      className="support-action-btn"
                      onClick={() => setActiveTab('bug')}
                    >
                      Report Your First Bug
                    </button>
                  </div>
                ) : (
                  <div className="support-reports-list">
                    {userBugReports.map((report) => (
                      <div key={report.id} className="support-report-card">
                        <div className="support-report-header">
                          <h3 className="support-report-title">{report.title}</h3>
                          <div className="support-report-meta">
                            <span className={`support-report-status ${report.status.toLowerCase()}`}>
                              {report.status === 'Open' ? '🔓 Open' : '🔒 Closed'}
                            </span>
                            <span className={`support-report-severity severity-${report.severity}`}>
                              {report.severity === 'low' && '🟢 Low'}
                              {report.severity === 'medium' && '🟡 Medium'}
                              {report.severity === 'high' && '🟠 High'}
                              {report.severity === 'critical' && '🔴 Critical'}
                            </span>
                          </div>
                        </div>
                        
                        <div className="support-report-details">
                          <div className="support-report-field">
                            <strong>Description:</strong>
                            <p>{report.description}</p>
                          </div>
                          
                          <div className="support-report-field">
                            <strong>Steps to Reproduce:</strong>
                            <p>{report.steps}</p>
                          </div>
                          
                          <div className="support-report-row">
                            <div className="support-report-field">
                              <strong>Expected Result:</strong>
                              <p>{report.expected}</p>
                            </div>
                            <div className="support-report-field">
                              <strong>Actual Result:</strong>
                              <p>{report.actual}</p>
                            </div>
                          </div>
                          
                          <div className="support-report-system-info">
                            <strong>System Information:</strong>
                            <p><strong>Browser:</strong> {report.browser}</p>
                            <p><strong>Device:</strong> {report.device}</p>
                          </div>
                          
                          <div className="support-report-timestamps">
                            <p><strong>Submitted:</strong> {new Date(report.createdAt).toLocaleDateString()} at {new Date(report.createdAt).toLocaleTimeString()}</p>
                            {report.updatedAt !== report.createdAt && (
                              <p><strong>Last Updated:</strong> {new Date(report.updatedAt).toLocaleDateString()} at {new Date(report.updatedAt).toLocaleTimeString()}</p>
                            )}
                          </div>
                        </div>
                        
                        {report.status === 'Open' && (
                          <div className="support-report-actions">
                            <button
                              className="support-close-report-btn"
                              onClick={() => closeBugReport(report.id)}
                              disabled={isSubmitting}
                            >
                              {isSubmitting ? '🔄 Closing...' : '✅ Mark as Resolved'}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Bug Report Tab */}
            {activeTab === 'bug' && (
              <div className="support-form-section">
                <h2>🐛 Report a Bug</h2>
                <p className="support-form-description">
                  Help us improve by reporting bugs or technical issues. The more details you provide, the faster we can fix it!
                </p>

                <form onSubmit={handleBugReportSubmit} className="support-form">
                  <div className="support-form-row">
                    <div className="support-form-group">
                      <label htmlFor="bugTitle">Bug Title *</label>
                      <input
                        type="text"
                        id="bugTitle"
                        name="bugTitle"
                        value={formData.bugTitle}
                        onChange={handleInputChange}
                        placeholder="Brief description of the bug"
                        required
                        maxLength={100}
                      />
                    </div>
                    <div className="support-form-group">
                      <label htmlFor="bugSeverity">Severity</label>
                      <select
                        id="bugSeverity"
                        name="bugSeverity"
                        value={formData.bugSeverity}
                        onChange={handleInputChange}
                      >
                        <option value="low">Low - Minor issue</option>
                        <option value="medium">Medium - Affects functionality</option>
                        <option value="high">High - Blocks important features</option>
                        <option value="critical">Critical - App unusable</option>
                      </select>
                    </div>
                  </div>

                  <div className="support-form-group">
                    <label htmlFor="bugDescription">Bug Description *</label>
                    <textarea
                      id="bugDescription"
                      name="bugDescription"
                      value={formData.bugDescription}
                      onChange={handleInputChange}
                      placeholder="Detailed description of what went wrong..."
                      required
                      rows="4"
                      maxLength={1000}
                    />
                  </div>

                  <div className="support-form-group">
                    <label htmlFor="bugSteps">Steps to Reproduce *</label>
                    <textarea
                      id="bugSteps"
                      name="bugSteps"
                      value={formData.bugSteps}
                      onChange={handleInputChange}
                      placeholder="1. Go to...&#10;2. Click on...&#10;3. See error..."
                      required
                      rows="4"
                      maxLength={1000}
                    />
                  </div>

                  <div className="support-form-row">
                    <div className="support-form-group">
                      <label htmlFor="bugExpected">Expected Result *</label>
                      <textarea
                        id="bugExpected"
                        name="bugExpected"
                        value={formData.bugExpected}
                        onChange={handleInputChange}
                        placeholder="What should have happened..."
                        required
                        rows="3"
                        maxLength={500}
                      />
                    </div>
                    <div className="support-form-group">
                      <label htmlFor="bugActual">Actual Result *</label>
                      <textarea
                        id="bugActual"
                        name="bugActual"
                        value={formData.bugActual}
                        onChange={handleInputChange}
                        placeholder="What actually happened..."
                        required
                        rows="3"
                        maxLength={500}
                      />
                    </div>
                  </div>

                  <div className="support-system-info">
                    <h4>System Information (Auto-detected):</h4>
                    <div className="support-system-details">
                      <p><strong>Browser:</strong> {formData.bugBrowser}</p>
                      <p><strong>Device:</strong> {formData.bugDevice}</p>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="support-submit-btn"
                    disabled={isSubmitting || !formData.bugTitle.trim() || !formData.bugDescription.trim() || !formData.bugSteps.trim() || !formData.bugExpected.trim() || !formData.bugActual.trim()}
                  >
                    {isSubmitting ? '📤 Submitting...' : '🐛 Submit Bug Report'}
                  </button>
                </form>
              </div>
            )}

          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}

export default Support;