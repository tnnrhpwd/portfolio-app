import React, { useState, useEffect } from 'react';
import Footer from '../Footer/Footer';
import NavBar from './../NavBar/NavBar';
import './GFreq.css';

// import getUserMedia from "get-user-media-promise";
// import MicrophoneStream from "microphone-stream";
// import Pitchfinder from "pitchfinder";


function GFreq() {
    // const [audioFrequency, setAudioFrequency] = useState(0);
    // const [audioNote, setAudioNote] = useState(0);
    // const [audioCents, setAudioCents] = useState(0);
    // const [audioNoteName, setAudioNoteName] = useState(0);
    // const [audioOctave, setAudioOctave] = useState(0);
    const [frequency, setFrequency] = useState(0);
    // const [note, setNote] = useState(0);



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
                    {/* {note} */}
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