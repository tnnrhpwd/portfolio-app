import React, { useEffect, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux'    
import { logout, resetDataSlice } from './../../features/data/dataSlice.js'
import HeaderDropper from '../HeaderDropper/HeaderDropper.jsx';
import HeaderLogo from '../../../src/assets/planit192.png';
import HeaderBell from '../HeaderBell/HeaderBell.jsx';
import './Header.css';

function Header() {
  const navigate = useNavigate() // initialization
  const dispatch = useDispatch() // initialization
  const { user } = useSelector((state) => state.data)   // select values from state
  const [ colTheme, setColTheme ] = useState(null);
  useEffect(() => {     // RUNS ON START -- Checks browser for color theme preference. Sets dark mode otherwise.
    const theme = localStorage.getItem('theme');
    if(theme==='light-theme') {
      setLightMode();
    } else if(theme==='dark-theme') {
      setDarkMode();
    } else {
      setDarkMode();
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
  // declare method to remove user item from local storage)
  const onLogout = () => {
    dispatch(logout())  // dispatch connects to the store, then remove user item from local storage
    dispatch(resetDataSlice())  // dispatch connects to the store, then reset state values( message, isloading, iserror, and issuccess )
    navigate('/')       // send user to dashboard, which will redirect to login page
  }
  return (
    <>
      <div className="planit-header">
        <div className="planit-header-logo">
          <a
            className='planit-header-logo-format'
            href="/"
            onClick={() => {
            window.scrollTo(0, 0);
          }}
          >
            Simple
            <img
              id="planit-header-logo-img"
              src={HeaderLogo}
              alt="website logo"
            />
            Action
          </a>
        </div>
        {/* <a href='/'> // deleted for now
          <div className='planit-header-title'>
            Planit
          </div>
        </a> */}
        {/* <a href='/plans'>
          <button className="planit-header-plan-portrait">
            +
          </button>
        </a> */}

        {/* <a href="/settings">
          <button className="planit-header-link-landscape">Settings</button>
        </a> */}
        {
          user ? (
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
          ) : null
          // <a href='/profile'> // deleted for now
          //   <button className="planit-header-link-landscape">
          //     Log in
          //   </button>
          // </a>
        }

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
        <HeaderDropper
          colTheme={colTheme}
          setLightMode={setLightMode}
          setDarkMode={setDarkMode}
        />
        <HeaderBell
          colTheme={colTheme}
          setLightMode={setLightMode}
          setDarkMode={setDarkMode}
        />
      </div>
    </>
  );
}

export default Header