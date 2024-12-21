import React from 'react';
import Header from './../../../components/Header/Header';
import './Simple.css';
import Footer from './../../../components/Footer/Footer';
import simplenetimg from './SimpleNET.png';
import simplenetactionimg from './SimpleNETAction.png'; // Import the second image
import simplenetobserveimg from './SimpleNETObserve.png';   // Import the third image

const simplelink = "https://github.com/tnnrhpwd/C-Simple";

function Simple() {
  return (
    <>
      <Header />
      <div className='planit-dashboard'>
        <div className='planit-dashboard-upper'>
          <header className='planit-dashboard-upper-header'>
            Empower Your Windows System with Intelligence
          </header>
          <p className='planit-dashboard-upper-description'>
            Our goal is to enhance your systems by giving them the intelligence to assist you effectively. Based on your previous interactions, each system would make informed decisions aimed at accurately predicting your actions, streamlining your workflow, and helping you achieve your goals.
          </p>
          <div className='planit-dashboard-download'>
            <a rel="noopener noreferrer" target="_blank"  href={simplelink} className='download-link'>
              Github Repository
            </a>
          </div>
        </div>
        <div className='planit-dashboard-lower'>
          <section className='planit-dashboard-preview'>
            <h2>Preview</h2>
            <ul>
              <li>
                <img className="planit-dashboard-preview-img" src={simplenetimg} alt="app home 1" />
              </li>
              <li>
                <img className="planit-dashboard-preview-img" src={simplenetactionimg} alt="app home 2" /> {/* Second image */}
              </li>
              <li>
                <img className="planit-dashboard-preview-img" src={simplenetobserveimg} alt="app home 3" /> {/* Third image */}
              </li>
            </ul>
          </section>
        </div>
        <Footer />
      </div>
    </>
  );
}

export default Simple;
