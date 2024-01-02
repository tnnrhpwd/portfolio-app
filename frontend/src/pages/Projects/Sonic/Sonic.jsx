import React, { useState } from 'react';
import Footer from '../../../components/Footer/Footer';
import FrequencyAnalyzer from './FrequencyAnalyzer';
import './Sonic.css';
import Header from '../../../components/Header/Header';

function Sonic() {
  const [noteData, setNoteData] = useState({});
  
  const handleNewNoteData = (newData) => {
    setNoteData(newData);
  };

  return (
    <>
      <Header />
        <div className="Sonic">
        <div className="Sonic-title">Sonic</div>
        <div className="Sonic-description">
          Audio Frequency and Note Analyzer
        </div>

        <div className="Sonic-col1">
          <div className="Sonic-calculator">
            <div className="Sonic-calculator-title">
              Frequency Calculator
            </div>
            <div className="Sonic-note-data">
              <div>Note: {noteData.noteName}</div>
              <div>Octave: {noteData.octave}</div>
              <div>Frequency: {noteData.frequency}</div>
            </div>
          </div>
        </div>

        <br />
        <a
          href="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/Sonic"
          rel="noopener noreferrer"
          target="_blank"
        >
          <button id="Sonic-sourcecode">View Source Code</button>
        </a>
      </div>
      <Footer />
      <FrequencyAnalyzer onNewNoteData={handleNewNoteData} />
    </>
  );
}

export default Sonic;
