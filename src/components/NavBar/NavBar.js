import React from "react";
import {Link} from 'react-router-dom';
import NavItem from "./NavItem";
import NavLogo from "./NavLogo";
// import icons  --may change to SVGs in the future
import homeLogo from './home.png';
import projectsLogo from './projects.png';
import contactLogo from './contact.png';
import STHlogo from './STHlogo192.png';
import './NavBar.css';

function NavBar({handleLoginClick}) { 

  const handleClick = () => {
    console.log("click");
    window.scrollTo(0,0);
    handleLoginClick();
  }

    return (
      <nav className="navbar">
          <span className='navbar-title' onClick={handleClick} >
            <NavLogo icon={STHlogo}/>
          </span>
          <ul className="navbar-nav"> 
          {/* {props.children} */}
          <NavItem icon={homeLogo} page="/"/>
          <NavItem icon={projectsLogo} page="/projects"/>
          <NavItem icon={contactLogo} page="/contact"/>
          </ul>
      </nav>
    );
  }
  
  export default NavBar;
  