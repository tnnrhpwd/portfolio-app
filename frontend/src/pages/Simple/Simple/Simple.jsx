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
            Our application is designed to enhance your Windows system by giving it the intelligence to assist you effectively. Based on your previous interactions, the system will make informed decisions aimed at accurately predicting your actions, streamlining your workflow, and helping you achieve your goals with precision.
          </p>
          <div className='planit-dashboard-download'>
            <a rel="noopener noreferrer" target="_blank"  href={simplelink} className='download-link'>
              Download Now
            </a>
          </div>
        </div>
        <div className='planit-dashboard-lower'>
          <section className='planit-dashboard-preview'>
            <h2>Key Features</h2>
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
          <section className='planit-dashboard-features'>
            <h2>Key Features</h2>
            <ul>
              <li>Intelligent Predictions</li>
              <li>Streamlined Workflow</li>
              <li>Goal-Oriented Assistance</li>
            </ul>
          </section>
          <section className='planit-dashboard-feedback'>
            <h2>User Feedback</h2>
            <p>"This app has transformed the way I work on my Windows system!"</p>
            <p>"Incredibly intuitive and helpful."</p>
          </section>
        </div>
        <Footer />
      </div>
    </>
  );
}

export default Simple;
