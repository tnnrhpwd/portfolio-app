import React, { useState } from 'react';
import Footer from '../../../components/Footer/Footer';
import NavBar from '../../../components/NavBar/NavBar';
import FrequencyAnalyzer from './FrequencyAnalyzer';
import './Sountrix.css';

function Sountrix() {
  const [noteData, setNoteData] = useState({});
  
  const handleNewNoteData = (newData) => {
    setNoteData(newData);
  };

  return (
    <>
      <NavBar />
      <div className="sountrix">
        <div className="sountrix-title">sountrix</div>
        <div className="sountrix-description">
          Audio Frequency and Note Analyzer
        </div>

        <div className="sountrix-col1">
          <div className="sountrix-calculator">
            <div className="sountrix-calculator-title">
              Frequency Calculator
            </div>
            <div className="sountrix-note-data">
              <div>Note: {noteData.noteName}</div>
              <div>Octave: {noteData.octave}</div>
              <div>Frequency: {noteData.frequency}</div>
            </div>
          </div>
        </div>

        <br />
        <a
          href="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/sountrix"
          rel="noopener noreferrer"
          target="_blank"
        >
          <button id="sountrix-sourcecode">View Source Code</button>
        </a>
      </div>
      <Footer />
      <FrequencyAnalyzer onNewNoteData={handleNewNoteData} />
    </>
  );
}

export default Sountrix;
