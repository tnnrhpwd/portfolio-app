import React, { useEffect, useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Link } from 'react-router-dom';
import { compressData, getLLMProviders, getMembershipPricing, resetDataSlice } from '../../../features/data/dataSlice.js';
import dataService from '../../../features/data/dataService.js';
import SimpleChat from '../../../components/SimpleAddon/SimpleChat.jsx';
import LoginGate from '../../../components/Simple/LoginGate/LoginGate.jsx';
import { useAddonDetection } from '../../../hooks/simpleAddon/useAddonDetection.js';
import './Net.css';
import Header from '../../../components/Header/Header.jsx';
import SimpleNav from '../../../components/Simple/SimpleNav/SimpleNav.jsx';

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

  // The app shell, so its height can be bound to what the visitor can see.
  const shellRef = useRef(null);

  /**
   * The shell's height, from the one measure that matches the screen.
   *
   * No viewport UNIT is enough on a phone. `vh`/`lvh` are the height with the
   * browser's bars retracted (so the composer sits under them), `svh` never
   * covers but leaves the shell short once they retract, and `dvh` tracks the
   * bars but not the soft KEYBOARD — a keyboard is not a "dynamic toolbar" to
   * the viewport units, so `dvh` still hides the composer behind it.
   *
   * `visualViewport.height` excludes all three. `Net.css` consumes it as
   * `--net-app-height` and keeps `dvh`/`svh` as the fallbacks for the first
   * paint and for a browser without this API.
   */
  useEffect(() => {
    const viewport = window.visualViewport;
    const shell = shellRef.current;
    if (!viewport || !shell) return undefined;

    let frame = 0;
    const apply = () => {
      frame = 0;
      // A pinch-zoom shrinks the visual viewport too, and resizing the shell to
      // it would fight the zoom — the height is only the app's while unzoomed.
      if (viewport.scale !== 1) return;
      const next = `${Math.round(viewport.height)}px`;
      // iOS fires this many times through a keyboard animation; only touch the
      // DOM when the value actually moved.
      if (shell.style.getPropertyValue('--net-app-height') !== next) {
        shell.style.setProperty('--net-app-height', next);
      }
    };
    // Coalesced to a frame: `scroll` on the visual viewport fires per pixel.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
    };
  }, []);

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
    // `provider`/`model` arrive already resolved by the chat (user's choice, else
    // the cheapest configured model). No default is named here: if one were, it
    // would override the backend's own default and bill a specific provider.
    async (message, conversationHistory, provider, model, extras = {}) => {
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
          } else if (event.type === 'progress') {
            streamCallbacksRef.current?.onProgress?.(event.label, event);
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
    (message, conversationHistory, provider, model, extras = {}) => {
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
      <Header center={<SimpleNav compact />} />
      {/* ⚠️ NO `<Footer />`, deliberately, and it is the one service page without
          one. Every other page ends in a scrolling document; this one is a
          single viewport-tall app shell (`100svh` on `.planit-nnet`), and a
          footer under it was a strip of marketing chrome below the composer —
          the thing that most made a chat read as a website rather than as an
          app. The same links live in the header's dropper (and on /about,
          /privacy, /terms), so nothing became unreachable. */}
      <div className="planit-nnet service-room" ref={shellRef}>
        <div className="net-hero-section">
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
