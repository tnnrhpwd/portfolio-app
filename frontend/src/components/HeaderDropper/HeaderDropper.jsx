import { useRef, useEffect, useState } from 'react'
import useOutsideAlerter from '../useOutsideAlerter.js';
// import HeaderLogo from './../../assets/planit192.png';
import { Link, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux'    
import React from 'react';

import { logout } from '../../features/data/dataSlice';

import './HeaderDropper.css'


function HeaderDropper(props) {
  const { user, dataIsError, dataMessage } = useSelector((state) => state.data);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [showHamburgerAnim, setShowHamburgerAnim] = useState(false);
  const toggleButtonRef = useRef(null);
  const insideComponentRef = useRef(null);

  // Show animation only once on homepage load
  useEffect(() => {
    if (window.location.pathname === '/') {
      setShowHamburgerAnim(true);
      const timer = setTimeout(() => setShowHamburgerAnim(false), 1200);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (dataIsError && dataMessage === 'Not authorized, token expired') {
      dispatch(logout());
      navigate('/login');
    }
  }, [dataIsError, dataMessage, dispatch, navigate]);

  const hideComponentVisibility = () => {document.getElementById("planit-header-dropper__toggle").checked = false;}
  const ComponentVisibility = () => {return document.getElementById("planit-header-dropper__toggle").checked}
  useOutsideAlerter( "nav", insideComponentRef, toggleButtonRef, ComponentVisibility, hideComponentVisibility );

  return (
    <div className="planit-header-dropper-space unclickable-background">
      <input id="planit-header-dropper__toggle" type="checkbox" />
      <label className={`planit-header-dropper__btn${showHamburgerAnim ? ' hamburger-animate' : ''}`} htmlFor="planit-header-dropper__toggle" ref={toggleButtonRef}>
        <span></span>
      </label>
      <ul ref={insideComponentRef} className="planit-header-dropper__box">
        <div className='planit-header-logo-nav'>
          <Link to='/' onClick={() => {window.scrollTo(0,0); document.getElementById("planit-header-dropper__toggle").checked = false;}}></Link>
        </div>
        
        {/* User Account & Settings (Always at top) */}
        {(props.colTheme==="dark-theme") && <button className='planit-header-dropper-themebutton' onClick={props.handleThemeToggle}>Light Mode</button>}
        {(props.colTheme==="light-theme") && <button className='planit-header-dropper-themebutton' onClick={props.handleThemeToggle}>Dark Mode</button>}
        {user ? (<>
          {(user) && <a className='planit-header-dropper-signer' href='/profile'>Signed in as {user.nickname}</a>}
          <a className='planit-header-dropper-profile' href='/profile'>Profile</a>
        </>) : (
          <a className='planit-header-dropper-profile' href='/login' >Log in</a>
        )}
        
        {/* Core Information */}
        <a className='planit-header-dropper-pagelink' href='/about'>◽About</a>
        <a className='planit-header-dropper-pagelink' href='/support'>◽Support</a>
        
        {/* Financial Tools */}
        <a className='planit-header-dropper-pagelink' href='/annuities'>◽Annuities</a>
        {user && <a className='planit-header-dropper-pagelink' href='/plans'>◽Plans</a>}
        
        {/* Utilities & Tools */}
        {user && (
          <>
            <a className='planit-header-dropper-pagelink' href='/passgen'>◽Passwords</a>
            <a className='planit-header-dropper-pagelink' href='/simple'>◽Simple</a>
            <a className='planit-header-dropper-pagelink' href='/net'>◽Net</a>
          </>
        )}
        
        {/* Games & Entertainment */}
        <a className='planit-header-dropper-pagelink' href='/wordle'>◽Wordle</a>
        
        {/* Admin (Special Access) */}
        {(user && user._id && user._id.toString() === '6770a067c725cbceab958619') && 
          <a className='planit-header-dropper-pagelink' href='/admin'>◽Admin</a>}
      </ul>
    </div>
  )
}

export default HeaderDropper