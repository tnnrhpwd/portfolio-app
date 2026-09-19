import React, { useEffect, useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Link, useSearchParams } from 'react-router-dom';
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

  /**
   * `/net?with=<userId>` opens a conversation with a member instead of the AI.
   *
   * The messenger's Talk page links here, and it is deliberately the SAME page:
   * a member DM is a different thing to talk to, not a different app, and it
   * reuses this shell (the viewport-height ladder, the composer above the
   * keyboard) rather than growing a second one.
   *
   * Nothing about this path touches the LLM: no provider fetch, no token spend,
   * and the transcript comes from the messenger's own endpoints.
   */
  const [searchParams] = useSearchParams();
  const peerId = searchParams.get('with') || '';
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

  // Fetch LLM providers on mount if user is logged in.
  //
  // Skipped for a member conversation (`?with=`): that view never calls a model,
  // and asking for the provider catalogue would fetch and bill nothing while
  // making the "no AI in this conversation" promise look untrue.
  useEffect(() => {
    if (user && !peerId) {
      dispatch(getLLMProviders());
    }
  }, [user, peerId, dispatch]);

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

  // Turn control (backend/services/harness/turnControl.js). Handed to the chat
  // as props rather than imported there, so the addon's renderer — which shares
  // SimpleChat — carries no knowledge of the cloud's turn endpoints.
  const handleCancelTurn = useCallback(
    (runId) => dataService.cancelTurn(runId, user?.token),
    [user]
  );

  const handleApproveTurn = useCallback(
    (approvalId, approved) => dataService.approveTurn(approvalId, approved, user?.token),
    [user]
  );

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
          } else if (event.type === 'step') {
            streamCallbacksRef.current?.onStep?.(event.step);
          } else if (event.type === 'plan') {
            streamCallbacksRef.current?.onPlan?.(event.plan);
          } else if (event.type === 'run') {
            // The turn's id — what the Stop button needs to cancel server-side.
            streamCallbacksRef.current?.onRun?.(event.runId);
          } else if (event.type === 'approval') {
            streamCallbacksRef.current?.onApproval?.(event.approval);
          } else if (event.type === 'approval-resolved') {
            streamCallbacksRef.current?.onApprovalResolved?.(event);
          } else if (event.type === 'cancelled') {
            streamCallbacksRef.current?.onCancelled?.(event.reason);
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
              redirectTo={peerId ? `/net?with=${encodeURIComponent(peerId)}` : '/net'}
              eyebrow="Net AI Chat"
              title="Sign in to Net AI Chat"
              subtitle="Your AI-powered assistant for automation, coding, and more."
            />
          ) : (
          <SimpleChat
            // A person's thread (`/net?with=<id>`) is rendered by the chat
            // itself, in the pane beside the same rail — not by a second
            // component that replaces the whole app. See SimpleChat's note.
            peerId={peerId}
            addonStatus={addonStatus}
            remoteAddonStatus={remoteAddonStatus}
            user={user}
            portfolioLLMProviders={llmProviders}
            onPortfolioChat={handlePortfolioChat}
            onPortfolioChatStream={handlePortfolioChatStream}
            onCancelTurn={handleCancelTurn}
            onApproveTurn={handleApproveTurn}
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
