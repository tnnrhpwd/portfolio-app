import React, { useEffect, useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { compressData, getLLMProviders, resetDataSlice } from '../../../features/data/dataSlice.js';
import dataService from '../../../features/data/dataService.js';
import CSimpleChat from '../../../components/CSimple/CSimpleChat.jsx';
import { useAddonDetection } from '../../../hooks/csimple/useAddonDetection.js';
import './Net.css';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';

function Net() {
  const dispatch = useDispatch();
  const { user, data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage, operation, llmProviders } = useSelector(
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

  // Track portfolio LLM response and errors for passing to CSimpleChat
  const [portfolioChatResponse, setPortfolioChatResponse] = React.useState(null);
  const [portfolioChatError, setPortfolioChatError] = React.useState(null);

  // Streaming callbacks ref (set by CSimpleChat)
  const streamCallbacksRef = useRef(null);

  // Fetch LLM providers on mount if user is logged in
  useEffect(() => {
    if (user) {
      dispatch(getLLMProviders());
    }
  }, [user, dispatch]);

  // Handle compressData response (fallback non-streaming path)
  useEffect(() => {
    if (operation === 'compress' && dataIsSuccess && data?.data) {
      const response = data.data[0] || data.data;
      setPortfolioChatResponse(typeof response === 'string' ? response : JSON.stringify(response));
      setPortfolioChatError(null);
      dispatch(resetDataSlice());
    }
  }, [operation, dataIsSuccess, data, dispatch]);

  // Handle compressData errors
  useEffect(() => {
    if (dataIsError && dataMessage) {
      setPortfolioChatError(dataMessage);
      dispatch(resetDataSlice());
    }
  }, [dataIsError, dataMessage, dispatch]);

  // Streaming chat handler — streams tokens directly to CSimpleChat callbacks
  const handlePortfolioChatStream = useCallback(
    async (message, conversationHistory, provider = 'openai', model = 'gpt-4o-mini') => {
      if (!user) return;

      const combinedData = JSON.stringify({ message, conversationHistory });
      const requestData = {
        data: JSON.stringify({ text: 'Net:' + combinedData }),
        provider,
        model,
      };

      try {
        const stream = dataService.compressDataStream(
          { data: JSON.stringify({ text: 'Net:' + combinedData }) },
          user.token,
          { provider, model }
        );
        for await (const event of stream) {
          if (event.type === 'token') {
            streamCallbacksRef.current?.onToken?.(event.text);
          } else if (event.type === 'content') {
            // Full content in one shot (tool-call fallback path)
            streamCallbacksRef.current?.onToken?.(event.text);
          } else if (event.type === 'tools') {
            streamCallbacksRef.current?.onTools?.(event.tools);
          } else if (event.type === 'error') {
            streamCallbacksRef.current?.onError?.(event.error);
            return;
          }
        }
        streamCallbacksRef.current?.onDone?.();
      } catch (err) {
        streamCallbacksRef.current?.onError?.(err.message, err.status);
      }
    },
    [user]
  );

  // Legacy non-streaming handler (fallback)
  const handlePortfolioChat = useCallback(
    (message, conversationHistory, provider = 'openai', model = 'gpt-4o-mini') => {
      if (!user) return;
      const combinedData = JSON.stringify({ message, conversationHistory });
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
          <CSimpleChat
            addonStatus={addonStatus}
            user={user}
            portfolioLLMProviders={llmProviders}
            onPortfolioChat={handlePortfolioChat}
            onPortfolioChatStream={handlePortfolioChatStream}
            streamCallbacksRef={streamCallbacksRef}
            portfolioChatLoading={dataIsLoading}
            portfolioChatResponse={portfolioChatResponse}
            portfolioChatError={portfolioChatError}
            showAddonPrompt={showInstallPrompt || showUpdatePrompt}
            addonPromptOutdated={isOutdated}
            addonPromptChecking={isChecking}
            onAddonRecheck={recheckAddon}
            onAddonDismiss={dismissPrompt}
            addonCurrentVersion={addonStatus.version}
            addonRequiredVersion={requiredVersion}
          />
        </div>
      </div>
    </>
  );
}

export default Net;
