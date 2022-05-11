import React, { useState, useEffect } from "react";
import NavItem from "./NavItem";
import NavLogo from "./NavLogo";
import ReactTooltip from "react-tooltip";
// import icons  --may change to SVGs in the future
import homeLogo from './home.png';
import projectsLogo from './projects.png';
import contactLogo from './contact.png';
import STHlogo from './STHlogo192.png';

// import SettingsPopup from '../SettingsPopup/SettingsPopup';
import './NavBar.css';

function NavBar() { 
  // const [isShowLogin, setIsShowLogin] = useState(false);
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

  function handleThemeToggle() {
    if(colTheme==='light-theme') {setDarkMode();}
    if(colTheme==='dark-theme') {setLightMode();}
  }

  // const handleLoginClick = () => {
    // window.scrollTo(0,0);
    // setIsShowLogin((isShowLogin) => !isShowLogin)
  // }

  return (<>
    <nav className="navbar">
      <span className='navbar-title' onClick={handleThemeToggle} >
        <NavLogo icon={STHlogo}/>
      </span>
      <ul className="navbar-nav"> 
        <div className="tooltip-space" data-tip="" data-for="tooltip-home" >
          <NavItem text="Home" icon={homeLogo} page="/"/>
        </div>
        <ReactTooltip id="tooltip-home" place="bottom" effect="solid">
          Home
        </ReactTooltip>
        <div className="tooltip-space" data-tip="" data-for="tooltip-projects" >
          <NavItem text="Projects" icon={projectsLogo} page="/projects"/>
        </div>
        <ReactTooltip id="tooltip-projects" place="bottom" effect="solid">
          Projects
        </ReactTooltip>
        <div className="tooltip-space" data-tip="" data-for="tooltip-contact" >
          <NavItem  text="Contact" icon={contactLogo} page="/contact"/>
        </div>
        <ReactTooltip id="tooltip-contact" place="bottom" effect="solid">
          Contact
        </ReactTooltip>
        
        
      </ul>
      
    </nav>
    {/* <div className="login-space">
      <SettingsPopup isShowLogin={isShowLogin} />
    </div> */}
  </>);
}
  
export default NavBar;
  