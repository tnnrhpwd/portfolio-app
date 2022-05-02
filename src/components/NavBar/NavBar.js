import React, { useState } from "react";
import NavItem from "./NavItem";
import NavLogo from "./NavLogo";
import ReactTooltip from "react-tooltip";
// import icons  --may change to SVGs in the future
import homeLogo from './home.png';
import projectsLogo from './projects.png';
import contactLogo from './contact.png';
import STHlogo from './STHlogo192.png';

import LoginForm from './../LoginForm/LoginForm';
import './NavBar.css';

function NavBar() { 
  const [isShowLogin, setIsShowLogin] = useState(false);

  const handleLoginClick = () => {
    window.scrollTo(0,0);
    setIsShowLogin((isShowLogin) => !isShowLogin)
  }

    return (<>
      <nav className="navbar">

        <span className='navbar-title' onClick={handleLoginClick} >
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
      <div className="login-space">
        <LoginForm isShowLogin={isShowLogin} />
      </div>

    </>);
  }
  
  export default NavBar;
  