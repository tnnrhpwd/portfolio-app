import { useRef } from 'react'
import useOutsideAlerter from '../../useOutsideAlerter.js';
import React from 'react';

function NNetBookView() {
  const hideComponentVisibility = () => {document.getElementById("planit-NNetBookView__toggle").checked = false;}
  const ComponentVisibility = () => {return document.getElementById("planit-NNetBookView__toggle").checked}
  const toggleButtonRef = useRef(null);  // reference to the dropper toggle button
  const isideComponentRef = useRef(null); // reference to the dropper container
  useOutsideAlerter( "book", isideComponentRef, toggleButtonRef, ComponentVisibility, hideComponentVisibility ); // listen for clicks outside dropper container && handle the effects

  console.log("NNetBookView rendered")

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
      Empty Captain!
    </div>
  </ul>
</div>

  )
}

export default NNetBookView