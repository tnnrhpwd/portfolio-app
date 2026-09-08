import React, { useEffect, useRef, useState, useCallback } from 'react';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import SEO from '../../components/SEO/SEO.jsx';
import { useAddonDetection } from '../../hooks/simpleAddon/useAddonDetection.js';
import {
  listAppAudioApps,
  startAppAudioRecording,
  stopAppAudioRecording,
  getAppAudioStatus,
  listAppAudioRecordings,
  downloadAppAudio,
} from '../../services/simpleAddonApi.js';
import './Strip.css';

function formatDuration(totalSeconds) {
  if (!totalSeconds || totalSeconds < 0) totalSeconds = 0;
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function Strip() {
  const { addonStatus, isChecking, recheckAddon } = useAddonDetection();
  const addonConnected = addonStatus?.isConnected === true;

  const [apps, setApps] = useState([]);
  const [selected, setSelected] = useState(''); // '' = all system audio
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [lastRecording, setLastRecording] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const timerRef = useRef(null);

  const loadApps = useCallback(async () => {
    try {
      const { apps } = await listAppAudioApps();
      setApps(Array.isArray(apps) ? apps : []);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const loadRecordings = useCallback(async () => {
    try {
      const { recordings } = await listAppAudioRecordings();
      setRecordings(Array.isArray(recordings) ? recordings : []);
    } catch {
      // recordings list is non-critical
    }
  }, []);

  useEffect(() => {
    if (!addonConnected) return;
    loadApps();
    loadRecordings();
    getAppAudioStatus()
      .then((s) => {
        if (s?.recording) {
          setRecording(true);
          setElapsed(Math.max(0, Math.floor((Date.now() - (s.startedAt || Date.now())) / 1000)));
        }
        if (s?.lastRecording) setLastRecording(s.lastRecording);
      })
      .catch(() => {});
  }, [addonConnected, loadApps, loadRecordings]);

  useEffect(() => {
    if (!recording) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timerRef.current);
  }, [recording]);

  const handleStart = async () => {
    setError('');
    setBusy(true);
    setLastRecording(null);
    try {
      const sel = apps.find((a) => a.name === selected);
      await startAppAudioRecording({
        ...(sel ? { appName: sel.name, appPid: sel.pid } : { appName: 'System Audio' }),
      });
      setRecording(true);
      setElapsed(0);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setError('');
    setBusy(true);
    try {
      const { recording: rec } = await stopAppAudioRecording();
      setRecording(false);
      setLastRecording(rec);
      loadRecordings();
    } catch (e) {
      setError(e.message);
      setRecording(false);
    } finally {
      setBusy(false);
    }
  };

  const selectedLabel = selected
    ? (apps.find((a) => a.name === selected)?.name || 'System Audio')
    : 'System Audio';

  return (
    <>
      <SEO
        title="App Audio Recorder"
        description="Record the audio playing on your PC and save it as an MP3, right from the browser."
        path="/strip"
      />
      <Header />

      <div className="strip">
        <div className="strip-floating" aria-hidden="true">
          <div className="strip-circle strip-circle-1" />
          <div className="strip-circle strip-circle-2" />
          <div className="strip-circle strip-circle-3" />
        </div>

        <section className="strip-section strip-hero">
          <div className="strip-title-wrap">
            <p className="strip-eyebrow">Desktop Recorder</p>
            <h1 className="strip-title">App Audio Recorder</h1>
            <p className="strip-subtitle">
              Pick an application, hit record, and save what it plays as an MP3.
            </p>
          </div>
        </section>

        <main id="main" className="strip-section">
          <div className="strip-card">
            {!addonConnected ? (
            <div className="strip-notice">
              <p>
                {isChecking
                  ? 'Looking for the Simple addon…'
                  : 'The Simple addon isn’t connected. Start "Simple Addon" on this PC, then try again.'}
              </p>
              <button
                className="strip-btn"
                type="button"
                onClick={recheckAddon}
                disabled={isChecking}
              >
                Check again
              </button>
            </div>
          ) : (
            <>
              <div className="strip-controls">
                <label className="strip-label" htmlFor="strip-app">
                  Application
                </label>
                <select
                  id="strip-app"
                  className="strip-select"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  disabled={recording || busy}
                >
                  <option value="">All applications (system audio)</option>
                  {apps.map((a) => (
                    <option key={a.name} value={a.name}>
                      {a.name}
                      {a.title ? ` — ${a.title}` : ''}
                    </option>
                  ))}
                </select>

                <div className="strip-actions">
                  {!recording ? (
                    <button
                      className="strip-btn strip-btn--record"
                      type="button"
                      onClick={handleStart}
                      disabled={busy}
                    >
                      {busy ? 'Starting…' : '● Record'}
                    </button>
                  ) : (
                    <button
                      className="strip-btn strip-btn--stop"
                      type="button"
                      onClick={handleStop}
                      disabled={busy}
                    >
                      {busy ? 'Saving…' : '■ Stop'}
                    </button>
                  )}
                </div>

                {recording && (
                  <div className="strip-live" role="status" aria-live="polite">
                    <span className="strip-live-dot" />
                    Recording {selectedLabel} · {formatDuration(elapsed)}
                  </div>
                )}
              </div>

              {error && (
                <div className="strip-error" role="alert">
                  {error}
                </div>
              )}

              {lastRecording && !recording && (
                <div className="strip-result" role="status" aria-live="polite">
                  <div className="strip-result-meta">
                    <strong>{lastRecording.name}</strong>
                    <span>
                      {formatBytes(lastRecording.size)} · {formatDuration(lastRecording.durationS)}
                    </span>
                  </div>
                  <button
                    className="strip-btn strip-btn--save"
                    type="button"
                    onClick={() => downloadAppAudio(lastRecording.name)}
                  >
                    Save MP3
                  </button>
                </div>
              )}

              {recordings.length > 0 && (
                <div className="strip-history">
                  <h2 className="strip-history-title">Recent recordings</h2>
                  {recordings.slice(0, 10).map((r) => (
                    <div key={r.name} className="strip-history-row">
                      <span className="strip-history-name" title={r.name}>
                        {r.name}
                      </span>
                      <span className="strip-history-size">{formatBytes(r.size)}</span>
                      <button
                        className="strip-link"
                        type="button"
                        onClick={() => downloadAppAudio(r.name)}
                      >
                        Save
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <p className="strip-note">
                Recording captures this PC’s output audio (WASAPI loopback). Pick the app
                that’s playing sound for the most accurate result.
              </p>
            </>
          )}
          </div>
        </main>
      </div>
      <Footer />
    </>
  );
}

export default Strip;
