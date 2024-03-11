import React from 'react';
import NNetChatView from '../../../components/Simple/NNetChatView/NNetChatView.jsx';
import './Net.css'
import Header from '../../../components/Header/Header.jsx';

function Net() {
  return (<>
    <Header />
    <div className='planit-nnet'>
        <NNetChatView />
    </div>
  </>
  );
}

export default Net;
