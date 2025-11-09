import { useState } from 'react';

/**
 * Custom hook to manage all state for Support component
 */
export const useSupportState = () => {
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

  return {
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
  };
};
