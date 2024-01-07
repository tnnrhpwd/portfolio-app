import { useRef, useEffect } from 'react';
import useOutsideAlerter from '../../useOutsideAlerter.js';
import React from 'react';
import { useDispatch } from 'react-redux';
import { ReactComponent as Book } from '../../../assets/book.svg';

function NNetBookView({ myChats, onChatClick }) {
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

  console.log(myChats);

  const handleChatClick = (clickedChat) => {
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
            <div key={index} className="planit-NNetBookView-box-body-chat" onClick={() => handleChatClick(chat)}>
              {chat.split("|Net:")[1].substring(0, 15)}...
            </div>
          ))}
        </div>
      </ul>
    </div>
  );
}

export default NNetBookView;