import { useRef } from 'react';
import useOutsideAlerter from '../../useOutsideAlerter.js';
import React from 'react';
import { useDispatch } from 'react-redux';
import { getData } from '../../../features/data/dataSlice.js'; // Import the action

function NNetBookView({ onChatClick }) {
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

  const sampleChats = [
    { id: 1, content: "Sample Chat 1..." },
    { id: 2, content: "Sample Chat 2..." },
    // Add more sample chats as needed
  ];

  const handleChatClick = (clickedChat) => {
    // Fetch data for the clicked chat
    dispatch(getData({ data: 'Net:' + clickedChat.id })); // Assuming 'Net:' is the key for chat data
    onChatClick(clickedChat); // Propagate the click event
  };

  return (
    <div className="planit-NNetBookView-space">
      <input id="planit-NNetBookView__toggle" type="checkbox" />
      <label className="planit-NNetBookView__btn" htmlFor="planit-NNetBookView__toggle" ref={toggleButtonRef}>
        <span>
          📕
        </span>
      </label>
      <ul ref={isideComponentRef} className="planit-NNetBookView__box">
        <div className='planit-NNetBookView-box-header'>
          Prior Chats
        </div>
        <div className='planit-NNetBookView-box-body'>
          {sampleChats.map((chat) => (
            <button key={chat.id} onClick={() => handleChatClick(chat)}>
              {chat.content.substring(0, 10)}...
            </button>
          ))}
        </div>
      </ul>
    </div>
  );
}

export default NNetBookView;
