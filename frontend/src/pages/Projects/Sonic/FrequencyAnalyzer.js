import { useCallback, useEffect, useRef, useState } from 'react';

const A4_FREQ = 440;
const A4_SEMITONE = 69;
const NOTE_STRINGS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const UPDATE_INTERVAL_MS = 100;
const SPECTRUM_BAR_COUNT = 48;

function frequencyToNote(freq) {
    const note = Math.round(12 * (Math.log(freq / A4_FREQ) / Math.log(2))) + A4_SEMITONE;
    const standardFrequency = A4_FREQ * Math.pow(2, (note - A4_SEMITONE) / 12);
    const cents = Math.floor((1200 * Math.log(freq / standardFrequency)) / Math.log(2));
    return {
        noteName: NOTE_STRINGS[((note % 12) + 12) % 12],
        octave: Math.floor(note / 12) - 1,
        cents,
        frequency: freq,
    };
}

// Downsamples a byte frequency array into a fixed number of bars for display,
// averaging within each bucket so the visualization stays a stable width.
function toSpectrumBars(byteFrequencyData, barCount) {
    const bars = new Array(barCount).fill(0);
    const usableLength = Math.floor(byteFrequencyData.length * 0.5); // skip the mostly-silent upper half
    const bucketSize = Math.max(1, Math.floor(usableLength / barCount));
    for (let i = 0; i < barCount; i++) {
        let sum = 0;
        const start = i * bucketSize;
        const end = Math.min(start + bucketSize, usableLength);
        for (let j = start; j < end; j++) { sum += byteFrequencyData[j]; }
        bars[i] = end > start ? sum / (end - start) : 0;
    }
    return bars;
}

// Custom hook that captures microphone audio, detects the dominant pitch,
// and exposes a downsampled spectrum for visualization.
export default function useFrequencyAnalyzer() {
    const [listening, setListening] = useState(false);
    const [noteData, setNoteData] = useState(null);
    const [spectrum, setSpectrum] = useState([]);
    const [error, setError] = useState("");

    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const streamRef = useRef(null);
    const intervalRef = useRef(null);

    const stop = useCallback(() => {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
        if (streamRef.current) { streamRef.current.getTracks().forEach(track => track.stop()); streamRef.current = null; }
        if (analyserRef.current) { analyserRef.current.disconnect(); analyserRef.current = null; }
        if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
        setListening(false);
    }, []);

    const start = useCallback(async () => {
        setError("");
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            const audioContext = new AudioContextClass();
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            const microphone = audioContext.createMediaStreamSource(stream);
            microphone.connect(analyser);
            // Intentionally NOT connected to audioContext.destination — we only
            // analyze the input, we don't want to play the mic back through speakers.

            audioContextRef.current = audioContext;
            analyserRef.current = analyser;

            const byteData = new Uint8Array(analyser.frequencyBinCount);

            intervalRef.current = setInterval(() => {
                analyser.getByteFrequencyData(byteData);
                const maxIndex = byteData.indexOf(Math.max(...byteData));
                const dominantFrequency = (audioContext.sampleRate / analyser.fftSize) * maxIndex;
                if (dominantFrequency > 0) {
                    setNoteData(frequencyToNote(dominantFrequency));
                }
                setSpectrum(toSpectrumBars(byteData, SPECTRUM_BAR_COUNT));
            }, UPDATE_INTERVAL_MS);

            setListening(true);
        } catch (err) {
            setError(
                err && err.name === 'NotAllowedError'
                    ? "Microphone access was denied. Please allow microphone permissions and try again."
                    : "Couldn't access the microphone. Make sure a microphone is connected and try again."
            );
            setListening(false);
        }
    }, []);

    // Always release the microphone and audio context when the component unmounts.
    useEffect(() => () => stop(), [stop]);

    return { listening, noteData, spectrum, error, start, stop };
}
