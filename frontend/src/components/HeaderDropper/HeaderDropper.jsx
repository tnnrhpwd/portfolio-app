import { useRef, useEffect } from 'react'
import useOutsideAlerter from '../useOutsideAlerter.js';
// import HeaderLogo from './../../assets/planit192.png';
import { Link, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux'    
import React from 'react';
import { setDarkMode, setLightMode } from '../../utils/theme';
import { logout } from '../../features/data/dataSlice';

import './HeaderDropper.css'

function HeaderDropper(props) {
  const { user, dataIsError, dataMessage } = useSelector((state) => state.data)   // select values from state
  const dispatch = useDispatch();

  const navigate = useNavigate();

  useEffect(() => {
    console.log('HeaderDropper dataMessage:', dataMessage)
    if (dataIsError && dataMessage === 'Not authorized, token expired') {
      dispatch(logout());
      navigate('/login');
    }
  }, [dataIsError, dataMessage, dispatch]);

  const hideComponentVisibility = () => {document.getElementById("planit-header-dropper__toggle").checked = false;}
  const ComponentVisibility = () => {return document.getElementById("planit-header-dropper__toggle").checked}
  const toggleButtonRef = useRef(null);  // reference to the dropper toggle button
  const insideComponentRef = useRef(null); // reference to the dropper container
  useOutsideAlerter( "nav", insideComponentRef, toggleButtonRef, ComponentVisibility, hideComponentVisibility ); // listen for clicks outside dropper container && handle the effects

  return (
    <div className="planit-header-dropper-space unclickable-background">
      <input id="planit-header-dropper__toggle" type="checkbox" />
      <label className="planit-header-dropper__btn" htmlFor="planit-header-dropper__toggle" ref={toggleButtonRef}>
        <span></span>
      </label>
      <ul ref={insideComponentRef} className="planit-header-dropper__box">
        
        <div className='planit-header-logo-nav'>
          <Link to='/' onClick={() => {window.scrollTo(0,0); document.getElementById("planit-header-dropper__toggle").checked = false;}}></Link>
        </div>
        {(props.colTheme==="dark-theme") && <button className='planit-header-dropper-themebutton' onClick={props.handleThemeToggle}>Light Mode</button>}
        {(props.colTheme==="light-theme") && <button className='planit-header-dropper-themebutton' onClick={props.handleThemeToggle}>Dark Mode</button>}
          {user ? (<>
            {(user) && <a className='planit-header-dropper-signer' href='/profile'>Signed in as {user.nickname}</a>}
            <a className='planit-header-dropper-profile' href='/profile'>Profile</a>
            </>) : (
            <a className='planit-header-dropper-profile' href='/login' >Log in</a>
          )}
        <a className='planit-header-dropper-pagelink' href='/about'>About</a>        
        {( user ) 
          ?(<>   
            {/* <a className='planit-header-dropper-pagelink' href='/settings'>Settings</a> */}
            {/* <a className='planit-header-dropper-pagelink' href='/agenda'>◽Agenda</a> */}
            <a className='planit-header-dropper-pagelink' href='/passgen'>◽Passwords</a>
            <a className='planit-header-dropper-pagelink' href='/annuities'>◽Annuities</a>
            <a className='planit-header-dropper-pagelink' href='/simple'>◽Simple</a>
            {/* <a className='planit-header-dropper-pagelink' href='/sonic'>◽Sonic</a> */}
            {/* <a className='planit-header-dropper-pagelink' href='/wordle'>◽Wordle</a> */}
            <a className='planit-header-dropper-pagelink' href='/net'>◽Net</a>
            <a className='planit-header-dropper-pagelink' href='/plans'>◽Plans</a>
          </>)
          :null
        }
      </ul>
    </div>
  )
}

export default HeaderDropper