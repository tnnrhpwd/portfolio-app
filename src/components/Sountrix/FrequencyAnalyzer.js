import { useState, useEffect } from 'react';

const A = 440, SEMITONE = 69, noteStrings = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];

export default function FrequencyAnalyzer() {
  const [data, setData] = useState([]);
  useEffect(() => {
    if (data.length > 15) data.shift();
  }, [data]);
  function setFrequencyData(newData) {
    setData(prevData => [...prevData, newData]);
  }
  const getFrequency = () => navigator.mediaDevices.getUserMedia({audio: true}).then(stream => {
    const audioContext = new AudioContext(), analyser = audioContext.createAnalyser(), microphone = audioContext.createMediaStreamSource(stream);
    analyser.fftSize = 2048;
    microphone.connect(analyser);
    analyser.connect(audioContext.destination);
    const dataArray = new Uint8Array(analyser.frequencyBinCount), freqArray = new Float32Array(analyser.frequencyBinCount);
    const updateFrequency = () => {
      analyser.getByteFrequencyData(dataArray);
      analyser.getFloatFrequencyData(freqArray);
      const maxIndex = dataArray.indexOf(Math.max(...dataArray)), frequency = audioContext.sampleRate / analyser.fftSize * maxIndex;
      setNoteData(frequency);
      setFrequencyData(freqArray.slice(100, 1000));
    };
    const intervalId = setInterval(updateFrequency, 100);
    return () => {
      clearInterval(intervalId);
      microphone.disconnect();
      analyser.disconnect();
    };
  }).catch(error => console.error(error));
  const setNoteData = freq => {
    const getNote = freq => Math.round(12 * (Math.log(freq / A) / Math.log(2))) + SEMITONE,
      getStandardFrequency = note => A * Math.pow(2, (note - SEMITONE) / 12),
      getCents = (frequency, note) => Math.floor((1200 * Math.log(frequency / getStandardFrequency(note))) / Math.log(2));
    const note = getNote(freq), cents = getCents(freq, note), noteName = noteStrings[note % 12], octave = parseInt(note / 12) - 1;
    setNoteData({
      note: note,
      cents: cents,
      noteName: noteName,
      octave: octave,
      frequency: freq
    });
  }
  return { data, getFrequency };
}
