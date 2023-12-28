import React, { useState, useEffect } from 'react';
import Footer from '../../../components/Footer/Footer';
import NavBar from '../../../components/NavBar/NavBar';
import './GFreq.css';

// import getUserMedia from "get-user-media-promise";
// import MicrophoneStream from "microphone-stream";
// import Pitchfinder from "pitchfinder";

const A = 440;
const SEMITONE = 69;
const noteStrings = [
    "C",
    "C♯",
    "D",
    "D♯",
    "E",
    "F",
    "F♯",
    "G",
    "G♯",
    "A",
    "A♯",
    "B"
];

function GFreq() {
    const [oscilActive, setOscilActive] =useState(false)
    const [audioFrequency, setAudioFrequency] = useState(0);
    const [audioNote, setAudioNote] = useState(0);
    const [audioCents, setAudioCents] = useState(0);
    // const [audioNoteName, setAudioNoteName] = useState("0");
    const [audioOctave, setAudioOctave] = useState(0);
    const [frequencyData, setFrequencyData] = useState([])
    const [frequencyCurrentArray, setFrequencyCurrentArray] = useState([])

    const toggleOscilloscope = () => {
        if(oscilActive){setOscilActive(false)}else{getFrequency()}
    }

    useEffect(() => {
        if (frequencyData.length > 15) {
            frequencyData.shift();
        }
    }, [frequencyData])
    

    function setFrequencyArray(newData){
        setFrequencyData((prevFrequency) => [...prevFrequency, newData]);
    }

    function getFrequency(){
        setOscilActive(true)
        const handleSuccess = (stream) => {
            const audioContext = new AudioContext();
            const analyser = audioContext.createAnalyser();
            const microphone = audioContext.createMediaStreamSource(stream);
            analyser.fftSize = 2048;

            microphone.connect(analyser);
            analyser.connect(audioContext.destination);
      
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const freqArray = new Float32Array(analyser.frequencyBinCount)
      
            const updateFrequency = () => {
              analyser.getByteFrequencyData(dataArray);
              analyser.getFloatFrequencyData(freqArray)
              const maxIndex = dataArray.indexOf(Math.max(...dataArray));
              const frequency = audioContext.sampleRate / analyser.fftSize * maxIndex;
              setNote(frequency)
              setFrequencyCurrentArray(freqArray.slice(100, 1000))
              console.log(freqArray.slice(100, 1000))
            };
      
            const intervalId = setInterval(updateFrequency, 100);
      
            return () => {
              clearInterval(intervalId);
              microphone.disconnect();
              analyser.disconnect();
            };
        };
      
        const handleError = (error) => {
            console.error(error);
        };
      
        navigator.mediaDevices.getUserMedia({audio: true})
            .then(handleSuccess)
            .catch(handleError);
    }
    

    function setNote(freq){
        const getNote = freq => {
            const note = 12 * (Math.log(freq / A) / Math.log(2));
            // if(note >= 0){ return Math.round(note) + SEMITONE; }
            return Math.round(note) + SEMITONE; 
        };
        const getStandardFrequency = note => {
            return A * Math.pow(2, (note - SEMITONE) / 12);
        };
        const getCents = (frequency, note) => {
            return Math.floor(
              (1200 * Math.log(frequency / getStandardFrequency(note))) / Math.log(2)
            );
        };
        const note = getNote(freq);
        const cents = getCents(freq, note);
        // const noteName = noteStrings[note % 12];
        const octave = parseInt(note / 12) - 1;
        setAudioNote(note)
        setAudioCents(cents)
        // setAudioNoteName(noteName) // for some reason this function does not work. after 30 min troubleshooting, no idea why.
        setAudioOctave(octave)
        setAudioFrequency(freq);
        setFrequencyArray(freq);
    }

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
                    <button id="gfreq-sourcecode" onClick={toggleOscilloscope}>Toggle Oscilloscope</button>
                    <br></br>

                    {(oscilActive) && (<div className='gfreq-calculator-history'>
                        <div className='gfreq-calculator-history-details'>
                            {!isNaN(audioNote) && "audioNote:"+(audioNote)+"("+(noteStrings[audioNote % 12])+")"}
                            <br></br>
                            {!isNaN(audioCents) && "audioCents:"+(audioCents)}
                            <br></br>
                            {!isNaN(audioOctave) && "audioOctave:"+(audioOctave)}
                            <br></br>
                            {!(audioFrequency === 0 ) && "audioFrequency:"+(audioFrequency)}
                        </div>
                        <br></br>
                        <div className="spectrum">
                            {frequencyCurrentArray.map((value, index) => (
                                <div
                                className="spectrum-bar"
                                key={index}
                                style={{
                                    height: `calc(var(--nav-size)*${value}*.0037)`
                                }}
                                />
                            ))}
                        </div>
                        <br></br>
                        <div className='gfreq-calculator-history-chart'>
                            {frequencyData.map((value, index) => (
                                <div
                                className='gfreq-calculator-history-bars'
                                key={index}
                                style={{
                                    height: `calc(var(--nav-size)*${value}*.0037)`,
                                }}
                                >{value}</div>
                            ))}
                        </div>
                    </div>)}
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