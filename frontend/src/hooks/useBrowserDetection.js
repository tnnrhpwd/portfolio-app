import { useEffect } from 'react';
import { getBrowserInfo, getDeviceInfo } from '../utils/supportUtils';

/**
 * Custom hook to detect browser and device information
 * @param {Object} user - Current user
 * @param {Function} setFormData - Form data setter
 * @param {Function} setActiveTab - Active tab setter
 */
export const useBrowserDetection = (user, setFormData, setActiveTab) => {
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
  }, [user, setFormData, setActiveTab]);
};
