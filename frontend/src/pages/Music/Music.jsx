import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO';
import {
  getMusicCatalog,
  generateSong,
  listSongs,
  deleteSong,
  getMusicToken,
} from '../../services/musicApi';
import './Music.css';

const STARTER_LYRICS = `[Verse]
Golden light across the water
Waking up to something new
Every step a little farther
Every sky a different blue

[Chorus]
We are singing, we are flying
Louder than the morning sun
Hold the moment, no denying
This is where it all begun`;

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function Music() {
  const [token, setToken] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState(STARTER_LYRICS);
  const [style, setStyle] = useState({ genre: 'pop', mood: 'upbeat', tempo: 'mid', instruments: [], reference: '' });
  const [voice, setVoice] = useState(null);
  const [consent, setConsent] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [songs, setSongs] = useState([]);
  const [recording, setRecording] = useState(false);

  const recorderRef = useRef(null);
  const streamRef = useRef(null);

  const loadSongs = useCallback(async (userToken) => {
    if (!userToken) return;
    try {
      const items = await listSongs(userToken);
      setSongs(items);
    } catch {
      // Library load failures shouldn't block the generator.
    }
  }, []);

  useEffect(() => {
    const userToken = getMusicToken();
    setToken(userToken);

    getMusicCatalog()
      .then(setCatalog)
      .catch(() => toast.error('Could not load the music catalog'));

    loadSongs(userToken);
  }, [loadSongs]);

  // ── Voice sample: record or upload ────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          setVoice({ dataUrl: reader.result, mimeType: blob.type, name: 'Recording', bytes: blob.size });
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      recorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (err) {
      toast.error(`Microphone unavailable: ${err.message}`);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (recorderRef.current) {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
    setRecording(false);
  }, []);

  const onFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      toast.error('Please choose an audio file (mp3, wav, m4a, webm…).');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setVoice({ dataUrl: reader.result, mimeType: file.type, name: file.name, bytes: file.size });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  const toggleInstrument = useCallback((inst) => {
    setStyle((prev) => {
      const has = prev.instruments.includes(inst);
      return {
        ...prev,
        instruments: has ? prev.instruments.filter((i) => i !== inst) : [...prev.instruments, inst],
      };
    });
  }, []);

  // ── Generate ──────────────────────────────────────────────────────────
  const onSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!token) {
      toast.info('Please sign in to generate a song.');
      return;
    }
    if (!voice) {
      toast.error('Record or upload a voice sample first.');
      return;
    }
    if (!consent) {
      toast.error('Please confirm you own this voice and consent to a voice clone.');
      return;
    }
    setGenerating(true);
    try {
      const res = await generateSong({ title, lyrics, style, voice, consent }, token);
      setResult(res);
      loadSongs(token);
      toast.success(res.mock ? 'Demo track generated!' : 'Song generated!');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  }, [token, voice, consent, title, lyrics, style, loadSongs]);

  const onDeleteSong = useCallback(async (songId) => {
    if (!token) return;
    try {
      await deleteSong(songId, token);
      setSongs((prev) => prev.filter((s) => s.id !== songId));
      toast.success('Song deleted');
    } catch (err) {
      toast.error(err.message);
    }
  }, [token]);

  const audioSrc = result?.tracks?.[0]
    ? `data:${result.tracks[0].mimeType};base64,${result.tracks[0].base64}`
    : null;

  return (
    <>
      <SEO
        title="Music — Sing as You"
        description="Generate a tailored song in your own voice from a voice sample, your lyrics, and a style."
        path="/music"
      />
      <Header />

      <div className="music">
        <div className="music-floating" aria-hidden="true">
          <div className="music-circle music-circle-1" />
          <div className="music-circle music-circle-2" />
          <div className="music-circle music-circle-3" />
        </div>

        <section className="music-section music-hero">
          <div className="music-title-wrap">
            <p className="music-eyebrow">AI Music Studio</p>
            <h1 className="music-title">Sing as You</h1>
            <p className="music-subtitle">
              Record your voice, write a few lines, pick a vibe — get back a song performed by a studio version of you.
            </p>
          </div>
        </section>

        <main id="main" className="music-section">
          {catalog && !catalog.configured && (
            <div className="music-notice" role="status">
              Music generation isn&apos;t configured on the server yet — the studio is in preview. Sign in to try the demo synth.
            </div>
          )}

          {!token && (
            <div className="music-notice" role="status">
              <Link to="/login">Sign in</Link> to generate songs and save them to your library.
            </div>
          )}

          <form className="music-card" onSubmit={onSubmit}>
            {/* Step 1 — voice sample */}
            <h2>1 · Your voice</h2>
            <div className="music-voice">
              {!voice ? (
                <div className="music-voice-empty">
                  <button type="button" className="music-btn" onClick={recording ? stopRecording : startRecording}>
                    {recording ? 'Stop recording' : 'Record your voice'}
                  </button>
                  <label className="music-btn music-btn-outline music-file-label">
                    Upload audio file
                    <input type="file" accept="audio/*" onChange={onFileChange} />
                  </label>
                  <p className="music-hint">30–90 seconds of clean speech or singing works best.</p>
                </div>
              ) : (
                <div className="music-voice-preview">
                  <audio src={voice.dataUrl} controls preload="metadata" />
                  <p className="music-hint">{voice.name} · {Math.max(1, Math.round((voice.bytes || 0) / 1024))} KB</p>
                  <button type="button" className="music-btn music-btn-outline" onClick={() => setVoice(null)}>
                    Replace sample
                  </button>
                </div>
              )}
            </div>

            {/* Step 2 — lyrics */}
            <h2>2 · Lyrics</h2>
            <label className="music-field">
              <span className="music-label">Song title</span>
              <input
                className="music-input"
                type="text"
                value={title}
                maxLength={120}
                placeholder="Surfing at Dawn"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="music-field">
              <span className="music-label">Lyrics</span>
              <textarea
                className="music-input music-textarea"
                value={lyrics}
                maxLength={4000}
                rows={10}
                onChange={(e) => setLyrics(e.target.value)}
              />
            </label>

            {/* Step 3 — style */}
            <h2>3 · Style</h2>
            <div className="music-grid">
              <label className="music-field">
                <span className="music-label">Genre</span>
                <select
                  className="music-input"
                  value={style.genre}
                  onChange={(e) => setStyle((s) => ({ ...s, genre: e.target.value }))}
                >
                  {(catalog?.genres || []).map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
              <label className="music-field">
                <span className="music-label">Mood</span>
                <select
                  className="music-input"
                  value={style.mood}
                  onChange={(e) => setStyle((s) => ({ ...s, mood: e.target.value }))}
                >
                  {(catalog?.moods || []).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="music-field">
                <span className="music-label">Tempo</span>
                <select
                  className="music-input"
                  value={style.tempo}
                  onChange={(e) => setStyle((s) => ({ ...s, tempo: e.target.value }))}
                >
                  {(catalog?.tempos || []).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </div>

            <div className="music-field">
              <span className="music-label">Instruments</span>
              <div className="music-chips">
                {(catalog?.instruments || []).map((inst) => (
                  <button
                    type="button"
                    key={inst}
                    className={`music-chip${style.instruments.includes(inst) ? ' music-chip--on' : ''}`}
                    onClick={() => toggleInstrument(inst)}
                  >
                    {inst}
                  </button>
                ))}
              </div>
            </div>

            <label className="music-field">
              <span className="music-label">Reference (optional)</span>
              <input
                className="music-input"
                type="text"
                value={style.reference}
                maxLength={400}
                placeholder="sunny 2000s pop"
                onChange={(e) => setStyle((s) => ({ ...s, reference: e.target.value }))}
              />
            </label>

            <label className="music-consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>I own this voice (or have permission) and consent to a voice clone being created for this song.</span>
            </label>

            <button className="music-btn music-generate" type="submit" disabled={generating}>
              {generating ? 'Generating…' : 'Generate my song'}
            </button>
          </form>

          {audioSrc && result && (
            <div className="music-card music-result">
              <h2>Your song</h2>
              <audio src={audioSrc} controls className="music-player" />
              <p className="music-hint">
                {result.title} · {fmtDate(result.createdAt || new Date().toISOString())}
              </p>
              {result.note && <p className="music-note">{result.note}</p>}
            </div>
          )}

          {token && (
            <div className="music-card music-library">
              <h2>Your library</h2>
              {songs.length === 0 ? (
                <p className="music-hint">No songs yet — generate your first one above.</p>
              ) : (
                <ul className="music-list">
                  {songs.map((s) => (
                    <li className="music-list-item" key={s.id}>
                      <div className="music-list-meta">
                        <span className="music-list-title">{s.title}</span>
                        <span className="music-list-sub">
                          {s.style?.genre} · {s.mock ? 'demo' : 'studio'} · {fmtDate(s.createdAt)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="music-btn music-btn-outline music-delete"
                        onClick={() => onDeleteSong(s.id)}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </main>
      </div>

      <Footer />
    </>
  );
}

export default Music;
