import { useRef } from 'react'
import useOutsideAlerter from '../useOutsideAlerter.js';
// import HeaderLogo from './../../assets/planit192.png';
import { Link, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux'    
import React from 'react';

import './HeaderBell.css'

function HeaderBell(props) {
  const { user } = useSelector((state) => state.data)   // select values from state
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
            🔔
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