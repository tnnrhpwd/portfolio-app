import { useRef, useEffect } from 'react';
import useOutsideAlerter from '../../useOutsideAlerter.js';
import React from 'react';
import { useDispatch } from 'react-redux';
import { ReactComponent as Book } from '../../../assets/book.svg';
import { ReactComponent as Delete } from '../../../assets/delete.svg';
import { ReactComponent as Archive } from '../../../assets/archive.svg';
import { ReactComponent as Copy } from '../../../assets/copy.svg';


function NNetBookView({ myChats, onChatClick, onDeleteData, onUpdateData, onCopyToClipboard }) {
  const dispatch = useDispatch(); // Initialize dispatch
  const hideComponentVisibility = () => {
    document.getElementById("planit-NNetBookView__toggle").checked = false;
  };

  const ComponentVisibility = () => {
    return document.getElementById("planit-NNetBookView__toggle").checked;
  };

  const toggleButtonRef = useRef(null); // reference to the dropper toggle button
  const isideComponentRef = useRef(null); // reference to the dropper container
  useOutsideAlerter("book", isideComponentRef, toggleButtonRef, ComponentVisibility, hideComponentVisibility); // listen for clicks outside dropper container && handle the effects
  
  const handleChatClick = (clickedChat) => { // input ex. '659887fa192e6e8a77e5d9c5 Creator:65673ec1fcacdd019a167520|Net:Steven:Wassaup, Baby!'
    // Fetch data for the clicked chat
    onChatClick(clickedChat); // Propagate the click event
  };

  return (
    <div className="planit-NNetBookView-space">
      <input id="planit-NNetBookView__toggle" type="checkbox" />
      <label className="planit-NNetBookView__btn" htmlFor="planit-NNetBookView__toggle" ref={toggleButtonRef}>
        <span>
          <Book className="planit-NNetBookView-book" />
        </span>
      </label>
      <ul ref={isideComponentRef} className="planit-NNetBookView__box">
        <div className='planit-NNetBookView-box-header'>
          Prior Chats
        </div>
        <div className='planit-NNetBookView-box-body'>
          {myChats.map((chat, index) => (
            <div key={index} className="planit-NNetBookView-box-body-chat">
              <div className='planit-NNetBookView-box-body-chat-mng'>
                <Delete className='planit-NNetBookView-box-body-chat-mng-btn' onClick={() => onDeleteData(index)}/>
                <Archive className='planit-NNetBookView-box-body-chat-mng-btn' onClick={() => onUpdateData(index, chat)}/>
                <Copy className='planit-NNetBookView-box-body-chat-mng-btn' onClick={() => onCopyToClipboard(chat)}/>
              </div>
              <span onClick={() => handleChatClick(chat)} className='planit-NNetBookView-box-body-chat-text'>
                {chat.split("|Net:")[1].substring(0, 15)}...
              </span>
            </div>
          ))}
        </div>
      </ul>
    </div>
  );
}

export default NNetBookView;