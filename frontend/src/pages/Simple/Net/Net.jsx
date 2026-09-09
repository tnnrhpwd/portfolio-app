import React, { useEffect, useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Link } from 'react-router-dom';
import { compressData, getLLMProviders, getMembershipPricing, resetDataSlice } from '../../../features/data/dataSlice.js';
import dataService from '../../../features/data/dataService.js';
import SimpleChat from '../../../components/SimpleAddon/SimpleChat.jsx';
import LoginGate from '../../../components/Simple/LoginGate/LoginGate.jsx';
import { useAddonDetection } from '../../../hooks/simpleAddon/useAddonDetection.js';
import { DEFAULT_CLOUD_MODEL_ID } from '../../../utils/llmProviderOptions.js';
import './Net.css';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';

function Net() {
  const dispatch = useDispatch();
  const { user, data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage, operation, llmProviders, membershipPricing } = useSelector(
    (state) => state.data
  );
  const {
    addonStatus,
    remoteAddonStatus,
    isChecking,
    recheckAddon,
    dismissPrompt,
    showInstallPrompt,
    showUpdatePrompt,
    isOutdated,
    requiredVersion,
    addonNeedsCertTrust,
    addonNeedsOptIn,
    enableAddonOptIn,
  } = useAddonDetection();

  // Track portfolio LLM response and errors for passing to SimpleChat
  const [portfolioChatResponse, setPortfolioChatResponse] = React.useState(null);
  const [portfolioChatError, setPortfolioChatError] = React.useState(null);

  // Streaming callbacks ref (set by SimpleChat)
  const streamCallbacksRef = useRef(null);

  // Fetch LLM providers on mount if user is logged in
  useEffect(() => {
    if (user) {
      dispatch(getLLMProviders());
    }
  }, [user, dispatch]);

  // Fetch membership pricing on mount (public endpoint, no auth needed)
  useEffect(() => {
    dispatch(getMembershipPricing());
  }, [dispatch]);

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

  // Streaming chat handler — streams tokens directly to SimpleChat callbacks
  const handlePortfolioChatStream = useCallback(
    async (message, conversationHistory, provider = 'bedrock', model = DEFAULT_CLOUD_MODEL_ID, extras = {}) => {
      if (!user) return;

      const payload = {
        message,
        conversationHistory,
        activeAgent: extras.activeAgent || null,
        behaviorFile: extras.behaviorFile || 'default.txt',
        image: extras.image || null,
      };
      const combinedData = JSON.stringify(payload);
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
          } else if (event.type === 'meta') {
            streamCallbacksRef.current?.onMeta?.({ tokens: event.tokens, cost: event.cost });
          } else if (event.type === 'title') {
            streamCallbacksRef.current?.onTitle?.(event.title);
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
    (message, conversationHistory, provider = 'bedrock', model = DEFAULT_CLOUD_MODEL_ID, extras = {}) => {
      if (!user) return;
      const payload = {
        message,
        conversationHistory,
        activeAgent: extras.activeAgent || null,
        behaviorFile: extras.behaviorFile || 'default.txt',
        image: extras.image || null,
      };
      const combinedData = JSON.stringify(payload);
      dispatch(
        compressData({
          data: { data: JSON.stringify({ text: 'Net:' + combinedData }) },
          options: { provider, model },
        })
      );
    },
    [user, dispatch]
  );

  // Clear response after SimpleChat consumes it
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
          <div className="net-market-link">
            <Link to="/market">Browse the Simple Marketplace →</Link>
          </div>
          {!user ? (
            <LoginGate
              redirectTo="/net"
              eyebrow="Net AI Chat"
              title="Sign in to Net AI Chat"
              subtitle="Your AI-powered assistant for automation, coding, and more."
            />
          ) : (
          <SimpleChat
            addonStatus={addonStatus}
            remoteAddonStatus={remoteAddonStatus}
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
            addonNeedsCertTrust={addonNeedsCertTrust}
            addonNeedsOptIn={addonNeedsOptIn}
            onAddonEnableOptIn={enableAddonOptIn}
            onAddonRecheck={recheckAddon}
            onAddonDismiss={dismissPrompt}
            addonCurrentVersion={addonStatus.version}
            addonRequiredVersion={requiredVersion}
            membershipPricing={membershipPricing}
          />
          )}
        </div>
      </div>
    </>
  );
}

export default Net;
