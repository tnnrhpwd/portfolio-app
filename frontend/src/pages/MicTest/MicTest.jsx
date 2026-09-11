import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO.jsx';
import useScrollReveal from '../../hooks/useScrollReveal';
import { useMicDevices } from '../../hooks/simpleAddon/useMicDevices';
import './MicTest.css';

/**
 * MicTest — microphone diagnostic page at /mic-test.
 *
 * Why this page exists: "my microphone doesn't work" is the single hardest
 * support issue to debug remotely, because the failure can be any of
 * permission, missing device, insecure context, browser capability, or a
 * device that opens but never produces samples. This page surfaces all of
 * those in one place and can copy a summary the user can paste into a ticket.
 *
 * Linked from the Advanced Settings "🔍 Diagnostic" control (which previously
 * pointed at a route that did not exist).
 */

/** Best-effort microphone permission state — not all browsers support the query. */
function useMicPermission() {
  const [state, setState] = useState('unsupported');

  useEffect(() => {
    let cancelled = false;
    let status;

    const read = () => {
      if (!cancelled) setState(status?.state || 'unknown');
    };

    if (!navigator.permissions?.query) {
      setState('unsupported');
      return () => {};
    }

    navigator.permissions
      .query({ name: 'microphone' })
      .then((result) => {
        status = result;
        read();
        result.addEventListener?.('change', read);
      })
      .catch(() => {
        // Firefox and Safari reject the 'microphone' descriptor.
        if (!cancelled) setState('unsupported');
      });

    return () => {
      cancelled = true;
      status?.removeEventListener?.('change', read);
    };
  }, []);

  return state;
}

const LEVEL_ERROR = -1;

function MicTest() {
  const [ref, visible] = useScrollReveal();
  const {
    devices,
    volumes,
    startMetering,
    stopMetering,
    isMetering,
    enumerateDevices,
  } = useMicDevices();
  const permission = useMicPermission();

  const isSecure = typeof window !== 'undefined' && window.isSecureContext !== false;
  const hasMediaDevices = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const hasAudioContext = typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);
  const speechSupported = typeof window !== 'undefined'
    && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  const toggleMetering = useCallback(async () => {
    if (isMetering) {
      stopMetering();
      return;
    }
    if (!hasMediaDevices) {
      toast.error('This browser cannot access microphones.');
      return;
    }
    await startMetering();
  }, [isMetering, stopMetering, startMetering, hasMediaDevices]);

  const refreshDevices = useCallback(async () => {
    await enumerateDevices();
    toast.success('Microphone list refreshed.', { autoClose: 2000 });
  }, [enumerateDevices]);

  const copyDiagnostics = useCallback(async () => {
    const lines = [
      'Simple — microphone diagnostic',
      `URL: ${window.location.href}`,
      `Secure context: ${isSecure ? 'yes' : 'no'}`,
      `MediaDevices API: ${hasMediaDevices ? 'yes' : 'no'}`,
      `AudioContext API: ${hasAudioContext ? 'yes' : 'no'}`,
      `Speech recognition API: ${speechSupported ? 'yes' : 'no'}`,
      `Microphone permission: ${permission}`,
      `Devices (${devices.length}):`,
      ...devices.map((d) => {
        const level = volumes[d.deviceId];
        const state = level === LEVEL_ERROR ? 'failed to open' : (level === undefined ? 'not tested' : `level ${level}`);
        return `  - ${d.label} [${d.deviceId.slice(0, 8)}…] — ${state}`;
      }),
      `User agent: ${navigator.userAgent}`,
    ];

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success('Diagnostic summary copied to clipboard.', { autoClose: 3000 });
    } catch {
      toast.error('Could not copy — select the text below instead.');
    }
  }, [devices, hasAudioContext, hasMediaDevices, isSecure, permission, speechSupported, volumes]);

  return (
    <>
      <SEO
        title="Microphone Diagnostic"
        description="Check microphone permissions, devices, and live input levels before reporting a voice-input problem."
        path="/mic-test"
      />
      <Header />

      <div className="mic">
        <div className="mic-floating" aria-hidden="true">
          <div className="mic-circle mic-circle-1" />
          <div className="mic-circle mic-circle-2" />
          <div className="mic-circle mic-circle-3" />
        </div>

        <section className="mic-section mic-hero">
          <div className="mic-title-wrap">
            <p className="mic-eyebrow">Diagnostic</p>
            <h1 className="mic-title">Microphone check</h1>
            <p className="mic-subtitle">
              Confirm your browser can reach a microphone, then watch the live level meter to
              find the device that is actually picking up sound.
            </p>
            <div className="mic-actions">
              <button className="mic-btn" type="button" onClick={toggleMetering} disabled={!hasMediaDevices}>
                {isMetering ? '⏹ Stop testing' : '🎤 Test microphones'}
              </button>
              <button className="mic-btn mic-btn-outline" type="button" onClick={refreshDevices}>
                ↻ Refresh devices
              </button>
            </div>
          </div>
        </section>

        <main id="main" className="mic-section mic-main">
          <div
            ref={ref}
            className={`mic-card mic-reveal ${visible ? 'is-visible' : ''}`}
          >
            <h2 className="mic-card__title">Environment</h2>
            <ul className="mic-checks">
              <Check ok={isSecure} label="Secure context (HTTPS or localhost)">
                Browsers block microphone access on plain HTTP pages.
              </Check>
              <Check ok={hasMediaDevices} label="MediaDevices API available">
                Required to open any audio input.
              </Check>
              <Check ok={hasAudioContext} label="Web Audio API available">
                Used for the live level meter.
              </Check>
              <Check ok={speechSupported} label="Speech recognition available">
                Needed for voice-to-text, not for recording.
              </Check>
              <li className="mic-checks__item">
                <span className={`mic-pill mic-pill--${permission === 'granted' ? 'ok' : permission === 'denied' ? 'bad' : 'muted'}`}>
                  {permission === 'unsupported' ? 'not reported' : permission}
                </span>
                <span className="mic-checks__label">Microphone permission</span>
              </li>
            </ul>
          </div>

          <div className="mic-card">
            <h2 className="mic-card__title">
              Devices
              {devices.length > 0 && <span className="mic-count">{devices.length}</span>}
            </h2>

            {!hasMediaDevices ? (
              <p className="mic-empty">
                This browser does not expose microphone access. Try Chrome, Edge, or Firefox on
                desktop.
              </p>
            ) : devices.length === 0 ? (
              <p className="mic-empty">
                No microphones detected. Check that a microphone is plugged in and that the
                browser has permission to see device names.
              </p>
            ) : (
              <ul className="mic-devices">
                {devices.map((dev) => {
                  const level = volumes[dev.deviceId];
                  const failed = level === LEVEL_ERROR;
                  const pct = typeof level === 'number' && level >= 0 ? Math.min(100, level) : 0;
                  return (
                    <li key={dev.deviceId} className="mic-device">
                      <div className="mic-device__head">
                        <span className="mic-device__name">{dev.label}</span>
                        <span className="mic-device__status">
                          {failed ? 'unavailable'
                            : typeof level === 'number' ? `${level}%`
                              : 'not tested'}
                        </span>
                      </div>
                      <div
                        className={`mic-device__meter ${failed ? 'is-failed' : ''}`}
                        role="meter"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={pct}
                        aria-label={`${dev.label} input level`}
                      >
                        <div className="mic-device__meter-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mic-card__footer">
              <button className="mic-link-btn" type="button" onClick={copyDiagnostics}>
                📋 Copy diagnostic summary
              </button>
            </div>
          </div>

          <div className="mic-card">
            <h2 className="mic-card__title">If nothing works</h2>
            <ol className="mic-steps">
              <li>Check the OS input device is set correctly (Windows: Settings → System → Sound).</li>
              <li>Grant microphone permission for this site, then reload the page.</li>
              <li>Close other apps that may be holding the microphone exclusively (Zoom, Teams, OBS).</li>
              <li>Use “Refresh devices” after plugging or unplugging a microphone.</li>
              <li>Still stuck? Use “Copy diagnostic summary” and paste it into a support ticket.</li>
            </ol>
          </div>
        </main>
      </div>

      <Footer />
    </>
  );
}

function Check({ ok, label, children }) {
  return (
    <li className="mic-checks__item">
      <span className={`mic-pill mic-pill--${ok ? 'ok' : 'bad'}`} aria-hidden="true">
        {ok ? '✓' : '✕'}
      </span>
      <span className="mic-checks__label">
        {label}
        <span className="mic-checks__hint">{children}</span>
      </span>
    </li>
  );
}

export default MicTest;
