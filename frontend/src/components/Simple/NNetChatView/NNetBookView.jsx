import { useRef } from 'react';
import useOutsideAlerter from '../../useOutsideAlerter.js';
import React from 'react';
import { ReactComponent as Book } from '../../../assets/book.svg';
import { ReactComponent as Delete } from '../../../assets/delete.svg';
import { ReactComponent as Archive } from '../../../assets/archive.svg';
import { ReactComponent as Copy } from '../../../assets/copy.svg';


function NNetBookView({ myChats, onChatClick, onDeleteData, onUpdateData, onCopyToClipboard, onNewChat }) {
  // const dispatch = useDispatch(); // Initialize dispatch
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
    hideComponentVisibility(); // Hide the dropper
    console.log('Clicked chat:', clickedChat);
  };

  const handleNewChat = () => {
    onNewChat();
    hideComponentVisibility();
  }

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
          <div className='planit-NNetBookView-box-header-title'>Prior Chats</div>
          <button onClick={handleNewChat} className='planit-NNetBookView-box-header-new'>New</button>
        </div>
        <div className='planit-NNetBookView-box-body'>
          {myChats.map((chat, index) => {
            const chatText = chat.data.text.split('|Net:')[1]; // Cut out everything before and including |Net:
            return (
              <div key={index} className="planit-NNetBookView-box-body-chat">
                <div className='planit-NNetBookView-box-body-chat-mng'>
                  <Delete className='planit-NNetBookView-box-body-chat-mng-btn' onClick={() => onDeleteData(index)}/>
                  <Archive className='planit-NNetBookView-box-body-chat-mng-btn' onClick={() => onUpdateData(index, chat)}/>
                  <Copy className='planit-NNetBookView-box-body-chat-mng-btn' onClick={() => onCopyToClipboard(chat)}/>
                </div>
                <span onClick={() => handleChatClick(chat) } className='planit-NNetBookView-box-body-chat-text'>
                  {chatText}...
                </span>
              </div>
            );
          })}
        </div>
      </ul>
    </div>
  );
}

export default NNetBookView;