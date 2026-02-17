import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Custom React hook for Text-to-Speech and Speech-to-Text using the Web Speech API.
 *
 * Features:
 * - TTS with configurable voice, rate, pitch
 * - Active STT (mic button) with continuous listening + auto-restart
 * - Passive wake-word listening: always-on background listener that activates
 *   when the agent's name is spoken, captures the rest as a command
 */
export function useSpeech({ agentName = '', wakeWordAliases = [], voiceURI = '', ttsEnabled = true, sttEnabled = false, micDeviceId = '' }) {
  const [voices, setVoices] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [isPassiveListening, setIsPassiveListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [sttSupported, setSttSupported] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [micLevel, setMicLevel] = useState(0);       // real-time mic audio level (0-1)
  const [passiveHeard, setPassiveHeard] = useState(''); // text heard in passive mode without wake word

  const recognitionRef = useRef(null);
  const passiveRecognitionRef = useRef(null);
  const synthRef = useRef(null);
  const wantListeningRef = useRef(false);    // true while active listening is desired
  const wantPassiveRef = useRef(false);       // true while passive wake-word listening is desired
  const agentNameRef = useRef(agentName);
  const aliasesRef = useRef(wakeWordAliases);
  const micDeviceIdRef = useRef(micDeviceId);
  const lastInterimRef = useRef('');               // pending interim transcript for active STT
  const activeMicRef = useRef(null);               // { stop() } for active mic meter
  const silenceTimerRef = useRef(null);            // auto-send after silence

  // Keep agentName ref current
  useEffect(() => { agentNameRef.current = agentName; }, [agentName]);
  // Keep aliases ref current
  useEffect(() => { aliasesRef.current = wakeWordAliases; }, [wakeWordAliases]);
  // Keep micDeviceId ref current
  useEffect(() => { micDeviceIdRef.current = micDeviceId; }, [micDeviceId]);

  // ─── Initialize ────────────────────────────────────────────────────────────

  useEffect(() => {
    // Check TTS support
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      synthRef.current = window.speechSynthesis;
      setTtsSupported(true);

      // Load voices (they load async in some browsers)
      const loadVoices = () => {
        const v = synthRef.current.getVoices();
        if (v.length > 0) {
          setVoices(v);
        }
      };

      loadVoices();
      synthRef.current.addEventListener('voiceschanged', loadVoices);
      return () => {
        synthRef.current?.removeEventListener('voiceschanged', loadVoices);
      };
    }
  }, []);

  useEffect(() => {
    // Check STT support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSttSupported(!!SpeechRecognition);
  }, []);

  // ─── TTS Functions ─────────────────────────────────────────────────────────

  /**
   * Speak a text string using the configured voice.
   */
  const speak = useCallback((text, options = {}) => {
    if (!synthRef.current || !ttsEnabled || !text) return;

    // Cancel any current speech
    synthRef.current.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    // Find the matching voice
    const targetURI = options.voiceURI || voiceURI;
    if (targetURI) {
      const voice = synthRef.current.getVoices().find(v => v.voiceURI === targetURI);
      if (voice) utterance.voice = voice;
    }

    utterance.rate = options.rate ?? 1.0;
    utterance.pitch = options.pitch ?? 1.0;
    utterance.volume = options.volume ?? 1.0;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    synthRef.current.speak(utterance);
  }, [voiceURI, ttsEnabled]);

  /**
   * Preview a voice by speaking a short sample.
   */
  const previewVoice = useCallback((voiceURIToPreview, agentNameForPreview = '') => {
    if (!synthRef.current) return;
    synthRef.current.cancel();

    const sampleText = agentNameForPreview
      ? `Hi, I'm ${agentNameForPreview}. How can I help you?`
      : 'This is a preview of my voice.';

    const utterance = new SpeechSynthesisUtterance(sampleText);
    const voice = synthRef.current.getVoices().find(v => v.voiceURI === voiceURIToPreview);
    if (voice) utterance.voice = voice;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    synthRef.current.speak(utterance);
  }, []);

  /**
   * Stop any current speech.
   */
  const stopSpeaking = useCallback(() => {
    synthRef.current?.cancel();
    setIsSpeaking(false);
  }, []);

  // ─── STT: Active Listening (mic button) ─────────────────────────────────

  const onResultRef = useRef(null);

  const createRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;
    return recognition;
  }, []);

  // Start real-time mic level meter for active listening UI using an existing stream
  const startActiveMicMeterFromStream = useCallback((stream) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const iv = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; s += d * d; }
        setMicLevel(Math.sqrt(s / buf.length));
      }, 60);
      activeMicRef.current = {
        stop: () => { clearInterval(iv); ctx.close().catch(() => {}); stream.getTracks().forEach(t => t.stop()); setMicLevel(0); }
      };
      console.log('[STT] Active mic meter started');
    } catch (e) {
      console.warn('[STT] Mic meter failed:', e);
    }
  }, []);

  const stopActiveMicMeter = useCallback(() => {
    activeMicRef.current?.stop();
    activeMicRef.current = null;
  }, []);

  /**
   * Start active listening (mic button). Stays on until stopListening().
   * Auto-restarts on silence/errors. Sends each final phrase to onResult.
   * NOTE: Active mode does NOT check for wake word — sends transcript directly.
   *
   * IMPORTANT: We open getUserMedia with the selected device BEFORE starting
   * SpeechRecognition. This "primes" Chromium to use the selected mic for
   * recognition, since SpeechRecognition has no deviceId option.
   */
  const startListening = useCallback(async (onResult) => {
    const recognition = createRecognition();
    if (!recognition) return;

    // Fully stop passive listening while active is on
    passiveStoppedRef.current = true;
    if (passiveRecognitionRef.current) {
      passiveRecognitionRef.current.abort();
      passiveRecognitionRef.current = null;
    }
    setIsPassiveListening(false);

    if (recognitionRef.current) recognitionRef.current.abort();

    onResultRef.current = onResult;
    wantListeningRef.current = true;
    setIsListening(true);
    setTranscript('');
    lastInterimRef.current = '';

    // Step 1: Open getUserMedia on the selected device to prime the browser
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const mid = micDeviceIdRef.current;
        const isPseudo = !mid || mid === 'default' || mid === 'communications';
        const constraints = isPseudo ? true : { deviceId: { exact: mid } };
        console.log('[STT] Priming mic for SpeechRecognition:', JSON.stringify(constraints));
        const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
        const track = stream.getAudioTracks()[0];
        console.log('[STT] Primed mic:', track?.label, 'deviceId:', track?.getSettings()?.deviceId?.substring(0, 12) + '...');
        // Start level meter using this stream
        startActiveMicMeterFromStream(stream);
      } catch (e) {
        console.warn('[STT] Mic prime failed (will use system default):', e.message);
      }
    } else {
      console.warn('[STT] navigator.mediaDevices not available (not a secure context). Mic priming skipped.');
    }

    // Step 2: Start SpeechRecognition (browser should now use the primed device)

    recognition.onstart = () => {
      console.log('[STT] Active listening started (SpeechRecognition session open)');
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (text) {
            // Active mode: send directly — no wake-word check
            console.log('[STT] Final:', text);
            setTranscript(text);
            lastInterimRef.current = '';
            if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
            onResultRef.current?.(text, text);
          }
        } else {
          interim += result[0].transcript;
        }
      }
      if (interim) {
        setTranscript(interim);
        lastInterimRef.current = interim;
        // Edge workaround: isFinal rarely fires, so auto-send after 2s of silence
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          silenceTimerRef.current = null;
          const pending = lastInterimRef.current?.trim();
          if (pending && wantListeningRef.current) {
            console.log('[STT] Silence timeout — sending interim as final:', pending);
            lastInterimRef.current = '';
            setTranscript(pending);
            onResultRef.current?.(pending, pending);
          }
        }, 2000);
      }
    };

    recognition.onerror = (event) => {
      console.warn('[STT] Error:', event.error);
      // not-allowed = mic permission denied — fatal, stop retrying
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        console.error('[STT] Active: mic permission denied. Ensure you are using HTTPS or localhost, and grant mic access.');
        wantListeningRef.current = false;
        setIsListening(false);
        stopActiveMicMeter();
        return;
      }
      // no-speech and aborted are not fatal — we'll restart in onend
    };

    recognition.onend = () => {
      console.log('[STT] Recognition ended, wantListening:', wantListeningRef.current);
      // Clear ref so we know the current session is dead
      recognitionRef.current = null;
      if (wantListeningRef.current) {
        // Auto-restart after a brief delay
        setTimeout(() => {
          if (wantListeningRef.current && !recognitionRef.current) {
            try {
              const newRecog = createRecognition();
              if (!newRecog) return;
              newRecog.onstart = recognition.onstart;
              newRecog.onresult = recognition.onresult;
              newRecog.onerror = recognition.onerror;
              newRecog.onend = recognition.onend;
              recognitionRef.current = newRecog;
              newRecog.start();
              console.log('[STT] Active listening restarted');
            } catch (e) {
              console.warn('[STT] Restart failed:', e);
              wantListeningRef.current = false;
              setIsListening(false);
            }
          }
        }, 300);
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (e) {
      console.warn('[STT] Start failed:', e);
    }
  }, [createRecognition]);

  /**
   * Stop active listening.
   */
  const stopListening = useCallback(() => {
    wantListeningRef.current = false;

    // Send any pending interim transcript before stopping
    const pending = lastInterimRef.current?.trim();
    if (pending && onResultRef.current) {
      console.log('[STT] Sending pending transcript on stop:', pending);
      onResultRef.current(pending, pending);
    }
    lastInterimRef.current = '';
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }

    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setTranscript('');
    stopActiveMicMeter();

    // Resume passive listening if it was on
    if (wantPassiveRef.current) {
      passiveStoppedRef.current = false;
      setTimeout(() => {
        if (wantPassiveRef.current && !wantListeningRef.current) {
          startPassiveListeningInternal();
        }
      }, 500);
    }
  }, [stopActiveMicMeter]);

  // ─── STT: Passive Wake-Word Listening ──────────────────────────────────

  const passiveCallbackRef = useRef(null);
  const passiveDebounceRef = useRef(null);
  const lastPassiveInterimRef = useRef('');
  const passiveStoppedRef = useRef(false);  // true when passive was intentionally stopped (prevents onend restart)

  const startPassiveListeningInternal = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[STT] SpeechRecognition not supported');
      return;
    }

    if (passiveRecognitionRef.current) {
      try { passiveRecognitionRef.current.abort(); } catch (e) { /* ignore */ }
      passiveRecognitionRef.current = null;
    }
    lastPassiveInterimRef.current = '';
    passiveStoppedRef.current = false;

    // Generate phonetic variants to match accent variations (southern US, etc.)
    const buildPhoneticVariants = (word) => {
      const w = word.toLowerCase().trim();
      const variants = new Set([w]);
      // Common substitution patterns for accent tolerance
      const subs = [
        [/ck/g, 'k'], [/ck/g, 'c'],
        [/et$/g, 'it'], [/et$/g, 'ut'], [/et$/g, 'at'],
        [/ro/g, 'ra'], [/ro/g, 'ru'], [/ro/g, 'raw'],
        [/ket$/g, 'kit'], [/ket$/g, 'kat'], [/ket$/g, 'cut'],
        [/ock/g, 'awk'], [/ock/g, 'ahk'], [/ock/g, 'uck'],
      ];
      for (const [pattern, replacement] of subs) {
        const v = w.replace(pattern, replacement);
        if (v !== w) variants.add(v);
      }
      // Also add without trailing punctuation/period
      variants.add(w.replace(/[.!?,;:]+$/, ''));
      return [...variants];
    };

    // Levenshtein distance for fuzzy matching
    const editDistance = (a, b) => {
      if (a.length === 0) return b.length;
      if (b.length === 0) return a.length;
      const matrix = [];
      for (let i = 0; i <= b.length; i++) matrix[i] = [i];
      for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
      for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
          const cost = b[i - 1] === a[j - 1] ? 0 : 1;
          matrix[i][j] = Math.min(
            matrix[i - 1][j] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j - 1] + cost
          );
        }
      }
      return matrix[b.length][a.length];
    };

    const checkWakeWord = (text) => {
      const name = agentNameRef.current?.toLowerCase()?.trim();
      if (!name || !text) return false;

      const textLower = text.toLowerCase();
      const textWords = textLower.replace(/[.!?,;:]+/g, '').split(/\s+/).filter(w => w.length > 0);

      // 1. Exact substring match (original check)
      let nameMatched = textLower.includes(name);

      // 2. Check aliases (words the browser actually hears when user says the name)
      if (!nameMatched) {
        const aliases = (aliasesRef.current || []).map(a => a.toLowerCase().trim()).filter(Boolean);
        nameMatched = aliases.some(alias => textLower.includes(alias));
        if (nameMatched) {
          console.log(`[STT] Alias match! Heard "${text}" matched alias in [${aliases.join(', ')}]`);
        }
      }

      // 3. Check individual words of multi-word name
      if (!nameMatched) {
        const nameWords = name.split(/[\s\-]+/).filter(w => w.length > 1);
        nameMatched = nameWords.length > 0 && nameWords.some(word => textLower.includes(word));
      }

      // 3. Fuzzy match: check each word in transcript against phonetic variants
      if (!nameMatched) {
        const variants = buildPhoneticVariants(name);
        nameMatched = textWords.some(word => {
          // Check against all phonetic variants
          if (variants.some(v => v === word)) return true;
          // Levenshtein: allow edit distance ≤ 2 for words of similar length
          if (Math.abs(word.length - name.length) <= 2) {
            const dist = editDistance(word, name);
            if (dist <= 2) return true;
            // Also check against variants
            return variants.some(v => editDistance(word, v) <= 1);
          }
          return false;
        });
        if (nameMatched) {
          console.log(`[STT] Fuzzy wake word match! Heard "${textWords.join(' ')}" ≈ "${name}"`);
        }
      }

      if (nameMatched) {
        const command = stripWakeWord(text, agentNameRef.current);
        console.log('[STT] 🎯 Wake word detected! Full:', text, '→ Command:', command);
        if (passiveDebounceRef.current) {
          clearTimeout(passiveDebounceRef.current);
          passiveDebounceRef.current = null;
        }
        lastPassiveInterimRef.current = '';
        // Stop passive listening before triggering callback
        stopPassiveInternals();
        wantPassiveRef.current = false; // Pause auto-restart
        passiveCallbackRef.current?.(command || '', text);
        return true;
      }
      // No wake word — show brief hint so user knows speech was heard
      console.log('[STT] 👂 Heard: "' + text + '" (waiting for "' + name + '")');
      setPassiveHeard(text);
      setTimeout(() => setPassiveHeard(''), 4000);
      return false;
    };

    // ─── Passive STT Strategy ─────────────────────────────────────────────
    // Use TWO parallel approaches for maximum reliability:
    //   1. VAD via Web Audio API — monitors mic levels to know when speech happens
    //   2. A single continuous SpeechRecognition session that runs independently
    //
    // Previous approach: VAD would start/stop short recognition sessions on voice
    // detection. This failed because sessions ended too quickly (no-speech errors)
    // before the browser could transcribe anything.
    //
    // New approach: Keep one continuous recognition session alive at all times.
    // VAD is only used for the mic level indicator and as a backup restart trigger.

    let audioContext = null;
    let analyser = null;
    let mediaStream = null;
    let vadInterval = null;
    let currentRecognition = null;
    let sessionRestartTimer = null;
    let sessionWatchdog = null;    // restarts session if no results in 20s
    let sessionCount = 0;
    let fatalError = false;  // true if a non-recoverable error occurred (e.g. not-allowed)
    let lastResultTime = 0;  // timestamp of last onresult event

    const startRecognitionSession = () => {
      if (currentRecognition || !wantPassiveRef.current || wantListeningRef.current || passiveStoppedRef.current || fatalError) return;

      sessionCount++;
      const sessionId = sessionCount;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;       // Keep session alive for ongoing listening
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 3;     // More alternatives increases wake-word hit rate
      currentRecognition = recognition;

      recognition.onstart = () => {
        // Only log first session start for debugging
        if (sessionId === 1) {
          console.log(`[STT] Passive listening session started`);
        }
        lastResultTime = Date.now();
        // Watchdog: if no results arrive within 20s, force-restart the session.
        // Chromium SpeechRecognition can enter a zombie state after rapid start/stop
        // cycles where onstart fires but audio is never transcribed.
        if (sessionWatchdog) clearInterval(sessionWatchdog);
        sessionWatchdog = setInterval(() => {
          if (!currentRecognition || fatalError || passiveStoppedRef.current) {
            clearInterval(sessionWatchdog);
            sessionWatchdog = null;
            return;
          }
          const elapsed = (Date.now() - lastResultTime) / 1000;
          if (elapsed > 20) {
            console.warn(`[STT] Passive session timeout (${elapsed.toFixed(0)}s no results) — restarting`);
            clearInterval(sessionWatchdog);
            sessionWatchdog = null;
            try { currentRecognition.abort(); } catch (e) { /* ignore */ }
            currentRecognition = null;
            // Will restart via onend handler
          }
        }, 5000);
      };

      recognition.onresult = (event) => {
        lastResultTime = Date.now();  // Reset watchdog timer
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          // Check all alternatives for wake word (not just the top one)
          const alternatives = [];
          for (let a = 0; a < result.length; a++) {
            alternatives.push(result[a].transcript.trim());
          }
          const bestText = alternatives[0] || '';

          if (result.isFinal) {
            lastPassiveInterimRef.current = '';
            // Check all alternatives for wake word
            for (const alt of alternatives) {
              if (checkWakeWord(alt)) return;
            }
          } else {
            lastPassiveInterimRef.current = bestText;
            // Check all alternatives for wake word (faster response)
            for (const alt of alternatives) {
              if (checkWakeWord(alt)) return;
            }
          }
        }
      };

      recognition.onerror = (event) => {
        // not-allowed = mic permission denied or no user gesture — fatal, stop retrying
        if (event.error === 'not-allowed') {
          console.error('[STT] ❌ Mic permission denied. Grant mic access in browser settings or click the mic button first.');
          fatalError = true;
          stopPassiveInternals();
          setIsPassiveListening(false);
          return;
        }
        // service-not-allowed = browser policy blocks STT — also fatal
        if (event.error === 'service-not-allowed') {
          console.error('[STT] ❌ Speech recognition service blocked by browser policy.');
          fatalError = true;
          stopPassiveInternals();
          setIsPassiveListening(false);
          return;
        }
        // no-speech and aborted are expected — don't log them (reduces clutter)
      };

      recognition.onend = () => {
        currentRecognition = null;

        // If a fatal error occurred or passive was stopped, do NOT restart
        if (fatalError || passiveStoppedRef.current || wantListeningRef.current) {
          // Only log when actively stopped (user action)
          if (passiveStoppedRef.current) {
            console.log('[STT] Passive listening stopped');
          }
          return;
        }

        // Check any pending interim transcript
        if (lastPassiveInterimRef.current) {
          if (checkWakeWord(lastPassiveInterimRef.current)) return;
          lastPassiveInterimRef.current = '';
        }

        // Auto-restart if still wanted (session may end due to silence timeout)
        if (wantPassiveRef.current) {
          // Brief delay to avoid tight restart loop
          const delay = sessionCount > 10 ? 2000 : 500;
          sessionRestartTimer = setTimeout(() => {
            sessionRestartTimer = null;
            if (wantPassiveRef.current && !wantListeningRef.current && !passiveStoppedRef.current) {
              startRecognitionSession();
            }
          }, delay);
        }
      };

      try {
        recognition.start();
      } catch (e) {
        console.warn('[STT] ⚠️ Session start failed:', e.message);
        currentRecognition = null;
        // Retry after delay
        if (wantPassiveRef.current) {
          sessionRestartTimer = setTimeout(() => {
            sessionRestartTimer = null;
            startRecognitionSession();
          }, 1000);
        }
      }
    };

    const startVAD = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        console.warn('[STT] Passive: navigator.mediaDevices not available (not a secure context — use HTTPS or localhost)');
        console.error('[STT] Passive: cannot start wake-word listening. Access via https:// or http://localhost');
        setIsPassiveListening(false);
        return;
      }
      try {
        // Use selected mic device if configured, otherwise system default
        // Opening getUserMedia FIRST "primes" Chromium to route SpeechRecognition
        // to this device (since SpeechRecognition has no deviceId option).
        const mid = micDeviceIdRef.current;
        const isPseudo = !mid || mid === 'default' || mid === 'communications';
        const audioConstraints = isPseudo
          ? true
          : { deviceId: { exact: mid } };
        console.log('[STT] VAD: opening mic with constraints:', JSON.stringify(audioConstraints));
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        // Explicitly resume — AudioContext can start suspended
        if (audioContext.state === 'suspended') {
          console.log('[STT] VAD: AudioContext suspended, resuming...');
          await audioContext.resume();
        }
        console.log('[STT] VAD: AudioContext state:', audioContext.state, 'sampleRate:', audioContext.sampleRate);
        const source = audioContext.createMediaStreamSource(mediaStream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.4;
        source.connect(analyser);

        // Use time-domain data (waveform) for debug logging
        const dataArray = new Uint8Array(analyser.fftSize);
        let debugCounter = 0;

        vadInterval = setInterval(() => {
          if (!wantPassiveRef.current) {
            stopPassiveInternals();
            return;
          }

          analyser.getByteTimeDomainData(dataArray);
          // Calculate RMS — values center at 128 (silence)
          let sumSquares = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const deviation = (dataArray[i] - 128) / 128;
            sumSquares += deviation * deviation;
          }
          const rms = Math.sqrt(sumSquares / dataArray.length);

          debugCounter++;
          // Only log first 3 VAD samples to verify mic is working
          if (debugCounter <= 3) {
            console.log(`[STT] 🎤 Mic level: ${rms.toFixed(4)}`);
          }
        }, 100);

        // Start continuous recognition session immediately (don't wait for VAD)
        // The getUserMedia call above primes the browser to use the correct mic
        startRecognitionSession();

        setIsPassiveListening(true);
        console.log('[STT] ✅ Passive listening enabled for wake word:', JSON.stringify(agentNameRef.current));
      } catch (e) {
        console.error('[STT] ❌ Failed to start passive listening:', e.message);
        console.error('[STT] Click the mic button to grant microphone permission.');
        setIsPassiveListening(false);
      }
    };

    const stopPassiveInternals = () => {
      if (vadInterval) {
        clearInterval(vadInterval);
        vadInterval = null;
      }
      if (sessionWatchdog) {
        clearInterval(sessionWatchdog);
        sessionWatchdog = null;
      }
      if (sessionRestartTimer) {
        clearTimeout(sessionRestartTimer);
        sessionRestartTimer = null;
      }
      if (currentRecognition) {
        try { currentRecognition.abort(); } catch (e) { /* ignore */ }
        currentRecognition = null;
      }
      if (audioContext && audioContext.state !== 'closed') {
        try { audioContext.close(); } catch (e) { /* ignore */ }
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
      }
    };

    // Store cleanup function for external stop
    passiveRecognitionRef.current = { abort: stopPassiveInternals };
    startVAD();
  }, []);

  /**
   * Enable passive wake-word listening. Listens in background for agent name.
   * When heard, calls onWakeCommand(command, fullTranscript).
   */
  const startPassiveListening = useCallback((onWakeCommand) => {
    passiveCallbackRef.current = onWakeCommand;
    wantPassiveRef.current = true;
    startPassiveListeningInternal();
  }, [startPassiveListeningInternal]);

  /**
   * Disable passive wake-word listening.
   */
  const stopPassiveListening = useCallback(() => {
    wantPassiveRef.current = false;
    passiveStoppedRef.current = true;
    if (passiveRecognitionRef.current) {
      passiveRecognitionRef.current.abort();
      passiveRecognitionRef.current = null;
    }
    setIsPassiveListening(false);
  }, []);

  /**
   * Resume passive listening using the previously-registered callback.
   * Use this after temporarily stopping passive (e.g. for pronunciation test).
   */
  const resumePassiveListening = useCallback(() => {
    if (passiveCallbackRef.current) {
      wantPassiveRef.current = true;
      passiveStoppedRef.current = false;
      startPassiveListeningInternal();
    }
  }, [startPassiveListeningInternal]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      wantPassiveRef.current = false;
      recognitionRef.current?.abort();
      passiveRecognitionRef.current?.abort();
      synthRef.current?.cancel();
    };
  }, []);

  return {
    // TTS
    voices,
    speak,
    previewVoice,
    stopSpeaking,
    isSpeaking,
    ttsSupported,

    // STT - Active (mic button)
    startListening,
    stopListening,
    isListening,
    transcript,
    sttSupported,
    micLevel,

    // STT - Passive (wake word)
    startPassiveListening,
    stopPassiveListening,
    resumePassiveListening,
    isPassiveListening,
    passiveHeard,
  };
}

/**
 * Strip the agent/wake word from the beginning of a transcript.
 * E.g., "Sarah, open edge" → "open edge"
 *       "Hey Sarah open edge" → "open edge"
 */
function stripWakeWord(text, agentName) {
  if (!agentName || !text) return text;

  const name = agentName.toLowerCase().trim();

  // Patterns: "Name, ..." / "Hey Name, ..." / "Name ..."
  const patterns = [
    new RegExp(`^hey\\s+${escapeRegex(name)}[,.]?\\s*`, 'i'),
    new RegExp(`^${escapeRegex(name)}[,.]?\\s*`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return text.substring(match[0].length).trim();
    }
  }

  // Fuzzy strip: remove first word if it's close to the wake word (edit distance ≤ 2)
  const words = text.split(/\s+/);
  if (words.length > 0) {
    const firstWord = words[0].toLowerCase().replace(/[.!?,;:]+$/, '');
    if (Math.abs(firstWord.length - name.length) <= 2) {
      // Inline edit distance for strip check
      const ed = ((a, b) => {
        const m = Array.from({ length: b.length + 1 }, (_, i) => [i]);
        for (let j = 0; j <= a.length; j++) m[0][j] = j;
        for (let i = 1; i <= b.length; i++)
          for (let j = 1; j <= a.length; j++)
            m[i][j] = Math.min(m[i-1][j]+1, m[i][j-1]+1, m[i-1][j-1]+(b[i-1]===a[j-1]?0:1));
        return m[b.length][a.length];
      })(firstWord, name);
      if (ed <= 2) {
        return words.slice(1).join(' ').replace(/^[,.]?\s*/, '').trim();
      }
    }
  }

  return text;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get voices split into local and remote groups for UI display.
 */
export function categorizeVoices(voices) {
  const local = [];
  const remote = [];
  for (const voice of voices) {
    const entry = {
      name: voice.name,
      voiceURI: voice.voiceURI,
      lang: voice.lang,
    };
    if (voice.localService) {
      local.push(entry);
    } else {
      remote.push(entry);
    }
  }
  return { local, remote };
}
