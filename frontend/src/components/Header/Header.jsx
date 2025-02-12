import React, { useEffect, useState } from 'react';
import HeaderDropper from './../HeaderDropper/HeaderDropper.jsx';
import HeaderLogo from '../../../src/assets/Checkmark512.png';
import { setDarkMode, setLightMode, setSystemColorMode } from '../../utils/theme.js';
import './Header.css';

function Header() {
  const [colTheme, setColTheme] = useState(null);

  useEffect(() => {
    const theme = localStorage.getItem('theme');
    if (theme === 'light-theme') {
      setLightMode();
      setColTheme('light-theme');
    } else if (theme === 'dark-theme') {
      setDarkMode();
      setColTheme('dark-theme');
    } else {
      setSystemColorMode();
      setColTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? 'dark-theme' : 'light-theme');
    }
  }, []);

  function handleThemeToggle() {
    if (colTheme === 'light-theme') {
      setDarkMode();
      setColTheme('dark-theme');
    } else if (colTheme === 'dark-theme') {
      setLightMode();
      setColTheme('light-theme');
    }
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
        <HeaderDropper
          colTheme={colTheme}
          setLightMode={setLightMode}
          setDarkMode={setDarkMode}
          handleThemeToggle={handleThemeToggle}
        />
      </div>
    </>
  );
}

export default Header;