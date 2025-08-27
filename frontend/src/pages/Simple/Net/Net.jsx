import React from 'react';
import NNetChatView from '../../../components/Simple/NNetChatView/NNetChatView.jsx';
import './Net.css'
import Header from '../../../components/Header/Header.jsx';

function Net() {
  return (<>
    <Header />
    <div className='planit-nnet'>
        {/* Floating background elements */}
        <div className="floating-shapes">
            <div className="floating-circle floating-circle-1"></div>
            <div className="floating-circle floating-circle-2"></div>
            <div className="floating-circle floating-circle-3"></div>
        </div>
        
        <div className="net-hero-section">
            <NNetChatView />
        </div>
    </div>
  </>
  );
}

export default Net;
