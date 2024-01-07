import React, { useEffect, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux'    
import { logout, resetDataSlice } from './../../features/data/dataSlice.js'
import NavItem from "./../NavBar/NavItem.jsx";
import HeaderDropper from './../HeaderDropper/HeaderDropper.jsx';
import ReactTooltip from "react-tooltip";
import projectsLogo from './../NavBar/projects.png';
import contactLogo from './../NavBar/contact.png';
import HeaderLogo from '../../../src/assets/Checkmark512.png';
import HeaderBell from '../HeaderBell/HeaderBell.jsx';
import './Header.css';

function Header() {
  const navigate = useNavigate() // initialization
  const dispatch = useDispatch() // initialization
  const { user } = useSelector((state) => state.data)   // select values from state
  const [ colTheme, setColTheme ] = useState(null);
  const [ portraitState, setPortraitState ] = useState(false);
  useEffect(() => {     // RUNS ON START -- Checks browser for color theme preference. Sets dark mode otherwise.
    const theme = localStorage.getItem('theme');
    if(theme==='light-theme') {
      setLightMode();
    } else if(theme==='dark-theme') {
      setDarkMode();
    } else {
      setDarkMode();
    }
    if(window.innerHeight > window.innerWidth){
      setPortraitState(true);
    }
  }, []);
  function setDarkMode(){
    setColTheme('dark-theme');  // set theme state variable 
    localStorage.setItem('theme', 'dark-theme'); // store preference in user storage 
    if(document.body.classList.contains('light-theme')){ // if theme already set
      document.body.classList.replace('light-theme', 'dark-theme');// set to dark mode
    }else{
      document.body.classList.add('dark-theme');
    }
  }
  function setLightMode(){
    setColTheme('light-theme');  // set theme state variable 
    localStorage.setItem('theme', 'light-theme'); // store preference in user storage 
    if(document.body.classList.contains('dark-theme')){ // if theme already set
      document.body.classList.replace('dark-theme', 'light-theme');// set to light mode
    }else{
      document.body.classList.add('light-theme');
    }
  }

  function handleThemeToggle() {
    if(colTheme==='light-theme') {setDarkMode();}
    if(colTheme==='dark-theme') {setLightMode();}
  }
  
  const onLogout = () => {
    dispatch(logout())  // dispatch connects to the store, then remove user item from local storage
    dispatch(resetDataSlice())  // dispatch connects to the store, then reset state values( message, isloading, iserror, and issuccess )
    navigate('/')       // send user to dashboard, which will redirect to login page
  }
  return (
    <>
      <div className="planit-header unclickable-background">
        <div className="planit-header-logo unclickable-background">
          <img
            id="planit-header-logo-img"
            src={HeaderLogo}
            onClick={handleThemeToggle}
            alt="website logo"
          />
          <a
            className='planit-header-logo-format'
            href="/" 
            onClick={() => {
              window.scrollTo(0, 0);
            }}
            >
            <div className="planit-header-logo-format-simple">Simple</div>
            <div className="planit-header-logo-format-sth"> by STHopwood</div>
          </a>
        </div>

        {user ? (
            <>             
              <a href="/text">
                <button className="planit-header-link-landscape">Text</button>
              </a>       
              <a href="/goals">
                <button className="planit-header-link-landscape">Goals</button>
              </a>
              <a href="/plans">
                <button className="planit-header-link-landscape">Plans</button>
              </a>
              <a href="/agenda">
                <button className="planit-header-link-landscape">Agenda</button>
              </a>
              <a href="/profile">
                <button className="planit-header-link-landscape">Profile</button>
              </a>
            </>
        ) : null}
        {/* <a href="/about">
          <button className="planit-header-link-landscape">About</button>
        </a> */}
        {/* {colTheme === "dark-theme" && (
          <button
            className="planit-header-themebutton-landscape"
            onClick={setLightMode}
          >
            Light Mode
          </button>
        )} */}
        {/* {colTheme === "light-theme" && (
          <button
            className="planit-header-themebutton-landscape"
            onClick={setDarkMode}
          >
            Dark Mode
          </button>
        )} */}
        {/* <button className="planit-header-profile-landscape">
          {user ? (
            <button className="planit-header-profile-auth" onClick={onLogout}>
              Log out
            </button>
          ) : (
            <a href="/login">
              <button className="planit-header-profile-auth">Log in</button>
            </a>
          )}
        </button> */}
        {/* <button className="planit-header-profile-auth" onClick={user ? onLogout : undefined}>
          {user ? "Log out" : <a href="/login">Log in</a>}
        </button> */}
        <HeaderBell
          colTheme={colTheme}
          setLightMode={setLightMode}
          setDarkMode={setDarkMode}
        />
        <HeaderDropper
          colTheme={colTheme}
          setLightMode={setLightMode}
          setDarkMode={setDarkMode}
        />
      </div>
    </>
  );
}

export default Header