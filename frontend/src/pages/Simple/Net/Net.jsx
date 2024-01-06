import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { updateData, resetDataSlice } from '../../../features/data/dataSlice.js';
import { toast } from 'react-toastify';
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
