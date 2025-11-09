import React from 'react';
import { useSelector } from 'react-redux';
import Spinner from '../../components/Spinner/Spinner.jsx';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import HelpFaqTab from '../../components/Support/HelpFaqTab.jsx';
import ReviewTab from '../../components/Support/ReviewTab.jsx';
import ContactTab from '../../components/Support/ContactTab.jsx';
import BugReportTab from '../../components/Support/BugReportTab.jsx';
import MyReportsTab from '../../components/Support/MyReportsTab.jsx';
import { useSupportState } from '../../hooks/useSupportState.js';
import { useBrowserDetection } from '../../hooks/useBrowserDetection.js';
import { useBugReports } from '../../hooks/useBugReports.js';
import { useSupportHandlers } from '../../hooks/useSupportHandlers.js';
import { faqData } from '../../data/supportData.js';
import { scrollToContent } from '../../utils/supportUtils.js';
import './Support.css';

/**
 * Support Page Component - Main orchestrator for all support functionality
 * 
 * This component serves as the central hub for:
 * - Help & FAQ (searchable knowledge base)
 * - Review submission (user feedback with ratings)
 * - Contact form (direct communication)
 * - Bug reporting (structured issue tracking)
 * - User bug reports management (view/close reports)
 */
function Support() {
  const { user, dataIsLoading } = useSelector((state) => state.data);

  // State management
  const {
    activeTab,
    setActiveTab,
    formData,
    setFormData,
    isSubmitting,
    setIsSubmitting,
    searchQuery,
    setSearchQuery,
    expandedFaq,
    setExpandedFaq,
    userBugReports,
    setUserBugReports,
    loadingReports,
    setLoadingReports,
    hoverRating,
    setHoverRating,
  } = useSupportState();

  // Browser detection (runs on mount)
  useBrowserDetection(user, setFormData, setActiveTab);

  // Bug reports management
  const { fetchUserBugReports, closeBugReport } = useBugReports(
    user,
    setLoadingReports,
    setUserBugReports,
    setIsSubmitting
  );

  // Form submission handlers
  const {
    handleInputChange,
    handleStarClick,
    handleReviewSubmit,
    handleContactSubmit,
    handleBugReportSubmit,
  } = useSupportHandlers(
    formData,
    setFormData,
    user,
    setIsSubmitting,
    activeTab,
    fetchUserBugReports
  );

  // FAQ search and toggle
  const filteredFaqs = faqData.filter(faq =>
    faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
    faq.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
    faq.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleFaqToggle = (faqId) => {
    setExpandedFaq(expandedFaq === faqId ? null : faqId);
  };

  // Tab navigation with scroll
  const handleTabClick = (tabName) => {
    setActiveTab(tabName);
    setTimeout(() => {
      scrollToContent();
    }, 100);
  };

  // Handle reports tab click with data fetching
  const handleReportsTabClick = () => {
    setActiveTab('reports');
    fetchUserBugReports();
    setTimeout(() => {
      scrollToContent();
    }, 100);
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

          {/* Tab Navigation */}
          <div className="support-tabs">
            <button
              className={`support-tab ${activeTab === 'help' ? 'active' : ''}`}
              onClick={() => handleTabClick('help')}
            >
              ❓ Help & FAQ
            </button>
            <button
              className={`support-tab ${activeTab === 'review' ? 'active' : ''}`}
              onClick={() => handleTabClick('review')}
            >
              ⭐ Leave Review
            </button>
            <button
              className={`support-tab ${activeTab === 'contact' ? 'active' : ''}`}
              onClick={() => handleTabClick('contact')}
            >
              💬 Contact Us
            </button>
            {user && (
              <button
                className={`support-tab ${activeTab === 'reports' ? 'active' : ''}`}
                onClick={handleReportsTabClick}
              >
                📋 My Reports
              </button>
            )}
            <button
              className={`support-tab ${activeTab === 'bug' ? 'active' : ''}`}
              onClick={() => handleTabClick('bug')}
            >
              🐛 Report Bug
            </button>
          </div>

          {/* Tab Content */}
          <div className="support-content">
            {activeTab === 'help' && (
              <HelpFaqTab
                faqData={filteredFaqs}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                expandedFaq={expandedFaq}
                handleFaqToggle={handleFaqToggle}
              />
            )}

            {activeTab === 'review' && (
              <ReviewTab
                formData={formData}
                handleInputChange={handleInputChange}
                handleStarClick={handleStarClick}
                handleReviewSubmit={handleReviewSubmit}
                isSubmitting={isSubmitting}
                hoverRating={hoverRating}
                setHoverRating={setHoverRating}
              />
            )}

            {activeTab === 'contact' && (
              <ContactTab
                formData={formData}
                handleInputChange={handleInputChange}
                handleContactSubmit={handleContactSubmit}
                isSubmitting={isSubmitting}
              />
            )}

            {activeTab === 'bug' && (
              <BugReportTab
                formData={formData}
                handleInputChange={handleInputChange}
                handleBugReportSubmit={handleBugReportSubmit}
                isSubmitting={isSubmitting}
              />
            )}

            {activeTab === 'reports' && user && (
              <MyReportsTab
                user={user}
                userBugReports={userBugReports}
                loadingReports={loadingReports}
                isSubmitting={isSubmitting}
                closeBugReport={closeBugReport}
                setActiveTab={setActiveTab}
              />
            )}
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}

export default Support;
