import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import HeaderDropper from './../HeaderDropper/HeaderDropper.jsx';
import HeaderLogo from '../../../src/assets/Checkmark512.png';
import { initTheme, setDarkMode, setLightMode, watchSystemTheme } from '../../utils/theme.js';
import { initScheme } from '../../utils/scheme.js';
import './Header.css';

/**
 * Site header. Fixed, `var(--nav-size)` tall.
 *
 * @param {object} [props]
 * @param {React.ReactNode} [props.center] - Optional node rendered *inside* the
 *   header band, horizontally centred between the logo and the menu. Product
 *   pages use it for the Simple surface switcher, so it costs no extra height
 *   instead of being stacked underneath and pushing the page down.
 */
function Header({ center }) {
  const [colTheme, setColTheme] = useState(null);

  useEffect(() => {
    // The scheme is painted before the mode is decided, because the two are
    // independent axes: colour is WHICH hues, mode is how light the surface under
    // them is. Applying it here means every page gets it, not just the one with the
    // picker on it.
    initScheme();
    setColTheme(initTheme().applied);
    // `system` is the only preference that can change without the visitor doing
    // anything, so this subscribes as well as applies. An explicit light or dark
    // is a decision, and the watcher will not overrule it.
    return watchSystemTheme(setColTheme);
  }, []);

  function handleThemeToggle() {
    // Clicking the logo is a manual choice, so it makes an EXPLICIT light/dark and
    // leaves `system` behind — rather than resolving the OS and persisting that.
    setColTheme(colTheme === 'dark-theme' ? setLightMode() : setDarkMode());
  }

  return (
    <>
      <div className="planit-header unclickable-background">
        <div className="planit-header-logo unclickable-background">
          <img
            id="planit-header-logo-img"
            src={HeaderLogo}
            onClick={handleThemeToggle}
            alt="STHopwood logo"
          />
          <Link
            className='planit-header-logo-format'
            to="/"
            onClick={() => {
              window.scrollTo(0, 0);
            }}
            >
            <div className="planit-header-logo-format-simple">Simple</div>
            <div className="planit-header-logo-format-sth"> by STHopwood</div>
          </Link>
        </div>
        {center && <div className="planit-header-center">{center}</div>}
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