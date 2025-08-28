import React from 'react';
import Header from './../../../components/Header/Header';
import './Simple.css';
import Footer from './../../../components/Footer/Footer';
import simpleGraphic from './simple_graphic.png';

const simplelink = "https://github.com/tnnrhpwd/C-Simple";

function Simple() {
  return (
    <>
      <Header />
      <div className='planit-dashboard'>
        <div className='planit-dashboard-upper'>
          <div className='work-in-progress-notice'>
            🚧 This project is currently a work in progress 🚧
          </div>
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
          <div className='planit-dashboard-preview'>
            <h2>System Intelligence Overview</h2>
            <div className='simple-graphic-container'>
              <img 
                src={simpleGraphic} 
                alt="Simple.NET System Intelligence Overview" 
                className='simple-graphic-img'
              />
            </div>
            <div className='planit-dashboard-features'>
              <h2>Key Features</h2>
              <ul>
                <li>🧠 <strong>Predictive Actions:</strong> Learn from your behavior patterns to anticipate your next moves</li>
                <li>⚡ <strong>Workflow Optimization:</strong> Streamline repetitive tasks with intelligent automation</li>
                <li>🎯 <strong>Goal-Oriented Assistance:</strong> Adapt to help you achieve your specific objectives</li>
                <li>📊 <strong>Real-time Analytics:</strong> Monitor system performance and user interaction patterns</li>
              </ul>
            </div>
          </div>
        </div>
        <Footer />
      </div>
    </>
  );
}

export default Simple;
