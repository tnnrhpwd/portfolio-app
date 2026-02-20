import React, { useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { compressData, getLLMProviders, resetDataSlice } from '../../../features/data/dataSlice.js';
import CSimpleChat from '../../../components/CSimple/CSimpleChat.jsx';
import AddonInstallPrompt from '../../../components/CSimple/AddonInstallPrompt.jsx';
import { useAddonDetection } from '../../../hooks/csimple/useAddonDetection.js';
import './Net.css';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';

function Net() {
  const dispatch = useDispatch();
  const { user, data, dataIsLoading, dataIsSuccess, operation, llmProviders } = useSelector(
    (state) => state.data
  );
  const {
    addonStatus,
    isChecking,
    recheckAddon,
    dismissPrompt,
    showInstallPrompt,
    showUpdatePrompt,
    isOutdated,
    requiredVersion,
  } = useAddonDetection();

  // Track portfolio LLM response for passing to CSimpleChat
  const [portfolioChatResponse, setPortfolioChatResponse] = React.useState(null);

  // Fetch LLM providers on mount if user is logged in
  useEffect(() => {
    if (user) {
      dispatch(getLLMProviders());
    }
  }, [user, dispatch]);

  // Handle compressData response
  useEffect(() => {
    if (operation === 'compress' && dataIsSuccess && data?.data) {
      const response = data.data[0] || data.data;
      setPortfolioChatResponse(typeof response === 'string' ? response : JSON.stringify(response));
      dispatch(resetDataSlice());
    }
  }, [operation, dataIsSuccess, data, dispatch]);

  // Callback for CSimpleChat to send messages via portfolio backend
  const handlePortfolioChat = useCallback(
    (message, conversationHistory, provider = 'openai', model = 'gpt-4o-mini') => {
      if (!user) return;

      // Format conversation for the portfolio API
      const combinedData = JSON.stringify({
        message,
        conversationHistory,
      });

      dispatch(
        compressData({
          data: { data: JSON.stringify({ text: 'Net:' + combinedData }) },
          options: { provider, model },
        })
      );
    },
    [user, dispatch]
  );

  // Clear response after CSimpleChat consumes it
  useEffect(() => {
    if (portfolioChatResponse) {
      const timer = setTimeout(() => setPortfolioChatResponse(null), 100);
      return () => clearTimeout(timer);
    }
  }, [portfolioChatResponse]);

  return (
    <>
      <Header />
      <div className="planit-nnet">
        {/* Floating background elements */}
        <div className="floating-shapes">
          <div className="floating-circle floating-circle-1"></div>
          <div className="floating-circle floating-circle-2"></div>
          <div className="floating-circle floating-circle-3"></div>
        </div>

        <div className="net-hero-section">
          {(showInstallPrompt || showUpdatePrompt) && (
            <AddonInstallPrompt
              isChecking={isChecking}
              onDismiss={dismissPrompt}
              onRecheck={recheckAddon}
              isOutdated={isOutdated}
              currentVersion={addonStatus.version}
              requiredVersion={requiredVersion}
            />
          )}

          <CSimpleChat
            addonStatus={addonStatus}
            user={user}
            portfolioLLMProviders={llmProviders}
            onPortfolioChat={handlePortfolioChat}
            portfolioChatLoading={dataIsLoading}
            portfolioChatResponse={portfolioChatResponse}
          />
        </div>
      </div>
      <Footer />
    </>
  );
}

export default Net;
