import React, { useEffect, useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { compressData, getLLMProviders, getMembershipPricing, resetDataSlice } from '../../../features/data/dataSlice.js';
import dataService from '../../../features/data/dataService.js';
import CSimpleChat from '../../../components/CSimple/CSimpleChat.jsx';
import { useAddonDetection } from '../../../hooks/csimple/useAddonDetection.js';
import './Net.css';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';

function Net() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
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
          {!user ? (
            <div className="net-login-prompt">
              <div className="net-login-card">
                <h2 className="net-login-title">◻ Net AI Chat</h2>
                <p className="net-login-subtitle">Your AI-powered assistant for automation, coding, and more.</p>
                {membershipPricing?.length > 0 && (
                  <div className="net-login-plans">
                    {membershipPricing.map((plan) => (
                      <div key={plan.id} className={`net-plan-chip ${plan.id === 'pro' ? 'net-plan-chip--featured' : ''}`}>
                        <span className="net-plan-chip__name">{plan.name}</span>
                        <span className="net-plan-chip__price">
                          {plan.price === 0 ? 'Free' : `$${(plan.price / 100).toFixed(0)}/mo`}
                        </span>
                        {plan.quota?.calls && (
                          <span className="net-plan-chip__quota">{plan.quota.calls}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="net-login-actions">
                  <button className="net-login-btn net-login-btn--primary" onClick={() => navigate('/login', { state: { redirectTo: '/net' } })}>
                    Log In
                  </button>
                  <button className="net-login-btn net-login-btn--secondary" onClick={() => navigate('/register', { state: { redirectTo: '/net' } })}>
                    Sign Up
                  </button>
                </div>
                <a className="net-login-link" href="/pricing">View all plans →</a>
              </div>
            </div>
          ) : (
          <CSimpleChat
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
