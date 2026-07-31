import React, { useState } from 'react';
import Footer from '../../../components/Footer/Footer';
import FrequencyAnalyzer from './FrequencyAnalyzer';
import './Sonic.css';
import Header from '../../../components/Header/Header';
import SEO from '../../../components/SEO/SEO.jsx';

function Sonic() {
  const [noteData, setNoteData] = useState({});
  const [soundCheck, setSoundCheck] = useState(false);

  const handleNewNoteData = (newData) => {
    setNoteData(newData);
  };
  const handleRunButtonClick = () => {
    setSoundCheck(true);
  };

  return (
    <>
      <SEO
        title="Sonic"
        description="Analyze audio frequencies and musical notes in real time with Sonic."
        path="/sonic"
      />
      <Header />
        <div className="Sonic">
        <h1 className="Sonic-title">Sonic</h1>
        <div className="Sonic-description">
          Audio Frequency and Note Analyzer
        </div>

        <div className="Sonic-col1">
          <div className="Sonic-calculator">
            <div className="Sonic-calculator-title">
              Frequency Calculator
            </div>
            <button id="Sonic-sourcecode" onClick={handleRunButtonClick}>
              Run
            </button>
            {soundCheck && (
              <FrequencyAnalyzer onNewNoteData={handleNewNoteData} />
            )}
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
    </>
  );
}

export default Sonic;
