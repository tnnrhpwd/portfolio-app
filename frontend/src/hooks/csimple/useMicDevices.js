import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Hook to enumerate audio input devices and provide live volume metering.
 *
 * Usage:
 *   const { devices, volumes, startMetering, stopMetering, isMetering } = useMicDevices();
 *
 * `devices`  — Array of { deviceId, label } for each audio input
 * `volumes`  — Map of deviceId → number (0–100) representing current volume level
 * `startMetering()` — Opens all mics and starts live volume monitoring
 * `stopMetering()`  — Closes all mic streams and stops monitoring
 * `isMetering`       — Whether metering is currently active
 */
export function useMicDevices() {
  const [devices, setDevices] = useState([]);
  const [volumes, setVolumes] = useState({});
  const [isMetering, setIsMetering] = useState(false);

  // Refs for cleanup
  const meterStreamsRef = useRef([]);     // { deviceId, stream, audioCtx, analyser, interval }[]
  const volumesRef = useRef({});

  // ─── Enumerate devices ─────────────────────────────────────────────────
  const enumerateDevices = useCallback(async () => {
    try {
      // We need at least one getUserMedia call to get labels (browsers hide labels until permission)
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        tempStream.getTracks().forEach(t => t.stop());
        console.log('[MicDevices] Got mic permission for label access');
      } catch (e) {
        console.warn('[MicDevices] Mic permission denied — labels may be hidden:', e.message);
      }

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices
        .filter(d => d.kind === 'audioinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${i + 1}`,
          groupId: d.groupId,
        }));
      console.log('[MicDevices] Found', audioInputs.length, 'audio inputs:', audioInputs.map(d => `${d.label} (${d.deviceId.substring(0, 8)}...)`));
      setDevices(audioInputs);
      return audioInputs;
    } catch (e) {
      console.warn('[MicDevices] Failed to enumerate:', e);
      return [];
    }
  }, []);

  // Enumerate on mount
  useEffect(() => {
    enumerateDevices();
    // Re-enumerate if devices change (plug/unplug)
    const handler = () => enumerateDevices();
    navigator.mediaDevices?.addEventListener('devicechange', handler);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', handler);
  }, [enumerateDevices]);

  // ─── Open a single mic and start metering ───────────────────────────────
  const openMicMeter = async (dev) => {
    try {
      // "default" and "communications" are pseudo-IDs — use plain { audio: true } for them
      // Real device IDs (long hex strings) MUST use { exact } or the browser ignores them
      const isPseudo = !dev.deviceId || dev.deviceId === 'default' || dev.deviceId === 'communications';
      const audioConstraints = isPseudo
        ? true
        : { deviceId: { exact: dev.deviceId } };

      console.log('[MicDevices] Opening mic:', dev.label, '| constraint:', JSON.stringify(audioConstraints));
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

      // Verify we got audio tracks
      const tracks = stream.getAudioTracks();
      console.log('[MicDevices]', dev.label, '→ got', tracks.length, 'audio track(s), enabled:', tracks[0]?.enabled, 'readyState:', tracks[0]?.readyState);

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // Explicitly resume — AudioContext can start suspended
      if (audioCtx.state === 'suspended') {
        console.log('[MicDevices] AudioContext suspended, resuming...');
        await audioCtx.resume();
      }
      console.log('[MicDevices]', dev.label, '→ AudioContext state:', audioCtx.state, 'sampleRate:', audioCtx.sampleRate);

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);

      // Use time-domain data (waveform) — more reliable than frequency data for volume detection
      const dataArray = new Uint8Array(analyser.fftSize);
      let debugCounter = 0;

      const interval = setInterval(() => {
        analyser.getByteTimeDomainData(dataArray);

        // Calculate RMS (root mean square) from the waveform
        // Values center at 128 (silence); deviation from 128 = sound
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const deviation = (dataArray[i] - 128) / 128;  // normalize to -1..+1
          sumSquares += deviation * deviation;
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);
        // Scale RMS to 0-100 (rms of 0.5 is already quite loud)
        const level = Math.min(100, Math.round(rms * 200));

        // Debug logging for first few and periodically
        debugCounter++;
        if (debugCounter <= 5 || debugCounter % 50 === 0) {
          // Sample a few values from the buffer
          const samples = [dataArray[0], dataArray[100], dataArray[500], dataArray[1000]];
          console.log(`[MicDevices] ${dev.label} | rms=${rms.toFixed(4)} level=${level} samples=[${samples}] ctxState=${audioCtx.state}`);
        }

        volumesRef.current = { ...volumesRef.current, [dev.deviceId]: level };
        setVolumes(v => ({ ...v, [dev.deviceId]: level }));
      }, 80);

      return { deviceId: dev.deviceId, stream, audioCtx, analyser, interval };
    } catch (e) {
      console.warn('[MicDevices] Failed to open mic:', dev.label, '|', e.name, e.message);
      return null;
    }
  };

  // ─── Start volume metering for all devices ──────────────────────────────
  const startMetering = useCallback(async () => {
    // Stop any existing metering first
    stopMeteringInternal();

    const devList = devices.length > 0 ? devices : await enumerateDevices();
    if (devList.length === 0) {
      console.warn('[MicDevices] No devices to meter');
      return;
    }

    console.log('[MicDevices] Starting metering for', devList.length, 'device(s)...');
    const newStreams = [];
    const newVolumes = {};

    // Open mics sequentially (parallel can cause issues with some drivers)
    for (const dev of devList) {
      const meter = await openMicMeter(dev);
      if (meter) {
        newStreams.push(meter);
        newVolumes[dev.deviceId] = 0;
      } else {
        newVolumes[dev.deviceId] = -1; // -1 = error / unavailable
      }
    }

    meterStreamsRef.current = newStreams;
    volumesRef.current = newVolumes;
    setVolumes(newVolumes);
    setIsMetering(true);
    console.log('[MicDevices] Metering started. Active streams:', newStreams.length, '/', devList.length);
  }, [devices, enumerateDevices]);

  // ─── Stop metering ─────────────────────────────────────────────────────
  const stopMeteringInternal = useCallback(() => {
    for (const meter of meterStreamsRef.current) {
      clearInterval(meter.interval);
      try { meter.audioCtx.close(); } catch {}
      meter.stream.getTracks().forEach(t => t.stop());
    }
    meterStreamsRef.current = [];
    volumesRef.current = {};
    setVolumes({});
    setIsMetering(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopMeteringInternal();
  }, [stopMeteringInternal]);

  return {
    devices,
    volumes,
    startMetering,
    stopMetering: stopMeteringInternal,
    isMetering,
    enumerateDevices,
  };
}
