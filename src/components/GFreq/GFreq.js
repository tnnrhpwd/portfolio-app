import React, { useState, useEffect } from 'react';
import Footer from '../Footer/Footer';
import NavBar from './../NavBar/NavBar';
import './GFreq.css';

import getUserMedia from "get-user-media-promise";
import MicrophoneStream from "microphone-stream";
// import Pitchfinder from "pitchfinder";


function GFreq() {
    // const [audioFrequency, setAudioFrequency] = useState(0);
    // const [audioNote, setAudioNote] = useState(0);
    // const [audioCents, setAudioCents] = useState(0);
    // const [audioNoteName, setAudioNoteName] = useState(0);
    // const [audioOctave, setAudioOctave] = useState(0);
    const [frequency, setFrequency] = useState(0);
    const [note, setNote] = useState(0);




    useEffect(() => {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(navigator.mediaDevices.getUserMedia({ audio: true }));
        const bufferSize = 2048;
        const buffer = new Float32Array(bufferSize);
    
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;
        microphone.connect(analyser);
    
        const autoCorrelate = (buf, sampleRate) => {
          const SIZE = buf.length;
          const MAX_SAMPLES = Math.floor(SIZE / 2);
          let bestOffset = -1, bestCorrelation = 0, lastCorrelation = 1, rms = 0, foundGoodCorrelation = false;
          let correlations = new Array(MAX_SAMPLES);
    
          for (let i = 0; i < SIZE; i++) {
            rms += buf[i] ** 2;
          }
          rms = Math.sqrt(rms / SIZE);
          if (rms < 0.01) return -1;
    
          for (let offset = 0; offset < MAX_SAMPLES; offset++) {
            let correlation = 0;
            for (let i = 0; i < MAX_SAMPLES; i++) {
              correlation += Math.abs(buf[i] - buf[i + offset]);
            }
            correlation = 1 - (correlation / MAX_SAMPLES);
            correlations[offset] = correlation;
            if ((correlation > 0.9) && (correlation > lastCorrelation)) {
              foundGoodCorrelation = true;
              if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestOffset = offset;
              }
            } else if (foundGoodCorrelation) {
              const shift = (correlations[bestOffset + 1] - correlations[bestOffset - 1]) / correlations[bestOffset];
              return sampleRate / (bestOffset + (8 * shift));
            }
            lastCorrelation = correlation;
          }
    
          return (bestCorrelation > 0.01) ? sampleRate / bestOffset : -1;
        };
    
        const getNoteFromFrequency = (frequency) => {
          const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
          const A4 = 440;
          const noteNumber = 12 * (Math.log(frequency / A4) / Math.log(2));
          const roundedNote = Math.round(noteNumber);
          const noteName = noteNames[roundedNote % 12];
          const octave = Math.floor((roundedNote / 12) - 1);
          return noteName + octave;
        };
    
        const updatePitch = () => {
          analyser.getFloatTimeDomainData(buffer);
          const ac = autoCorrelate(buffer, audioContext.sampleRate);
          if (ac !== -1) {
            const frequency = audioContext.sampleRate / ac;
            setFrequency(frequency);
            setNote(getNoteFromFrequency(frequency));
          }
        };
    
        const updateInterval = setInterval(updatePitch, 100);
    
        return () => clearInterval(updateInterval);
      }, []);
    





    return (<>
        <NavBar/>
        <div className='gfreq'>
            <div className="gfreq-title">
                GFreq
            </div>
            <div className="gfreq-description">
                Audio Frequency and Note Analyzer
            </div>

            <div className='gfreq-col1'>
                <div className='gfreq-calculator'>
                    <div className='gfreq-calculator-title'>
                        Frequency Calculator
                    </div>
                    {/* {audioFrequency}
                    {audioNote}
                    {audioCents}
                    {audioNoteName}
                    {audioOctave} */}
                    {note}
                    {frequency}
                </div>
            </div>

            <br/>
            <a href="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/GFreq" rel="noopener noreferrer"  target="_blank">
                <button id="gfreq-sourcecode">View Source Code</button>
            </a>

        </div>
        <Footer/>
    </>)
}

export default GFreq