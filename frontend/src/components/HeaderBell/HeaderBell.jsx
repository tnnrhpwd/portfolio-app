import { useRef } from 'react'
import useOutsideAlerter from '../useOutsideAlerter.js';
import React from 'react';
import { ReactComponent as BellIcon } from './bell.svg'; // Import the SVG

import './HeaderBell.css'

function HeaderBell(props) {
  const hideComponentVisibility = () => {document.getElementById("planit-header-bell__toggle").checked = false;}
  const ComponentVisibility = () => {return document.getElementById("planit-header-bell__toggle").checked}
  const toggleButtonRef = useRef(null);  // reference to the dropper toggle button
  const isideComponentRef = useRef(null); // reference to the dropper container
  useOutsideAlerter( "menu", isideComponentRef, toggleButtonRef, ComponentVisibility, hideComponentVisibility ); // listen for clicks outside dropper container && handle the effects

  return (
    <div className="planit-header-bell-space unclickable-background">
      <input id="planit-header-bell__toggle" type="checkbox" />
      <label className="planit-header-bell__btn" htmlFor="planit-header-bell__toggle" ref={toggleButtonRef}>
        <span>
          <BellIcon className="bell-icon" />        
        </span>
      </label>
      <ul ref={isideComponentRef} className="planit-header-bell__box">
        <div className='planit-header-bell-box-header'>
          Notifications
        </div>
        <div className='planit-header-bell-box-body'>
          All clear Captain!
        </div>
      </ul>
    </div>
  )
}

export default HeaderBell