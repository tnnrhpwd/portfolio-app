import { useRef, useEffect, useState } from 'react'
import useOutsideAlerter from '../useOutsideAlerter.js';
import { Link, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux'
import React from 'react';

import { logout } from '../../features/data/dataSlice';

import './dropper.css'
import { canUseAdminConsole, isMuseVisitor as isMuseVisitorAllowed } from '../../constants/admin';


function HeaderDropper(props) {
  const { user, dataIsError, dataMessage } = useSelector((state) => state.data);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [showHamburgerAnim, setShowHamburgerAnim] = useState(false);
  const toggleButtonRef = useRef(null);
  const insideComponentRef = useRef(null);

  // Admin + muse gating is cosmetic (the backend independently enforces it via
  // middleware/adminAccess.js); the check prefers the server-provided isAdmin
  // flag and also lets a "Special" account in — to the four read-only views the
  // console itself then limits it to.
  const isAdmin = canUseAdminConsole(user);
  const isMuseVisitor = isMuseVisitorAllowed(user);

  // Show a subtle pulse once on homepage load.
  useEffect(() => {
    if (window.location.pathname === '/') {
      setShowHamburgerAnim(true);
      const timer = setTimeout(() => setShowHamburgerAnim(false), 2200);
      return () => clearTimeout(timer);
    }
  }, []);

  // Handle auth errors and update component when user logs out.
  useEffect(() => {
    if (dataIsError && dataMessage === 'Not authorized, token expired') {
      dispatch(logout());
      navigate('/login');
    }
  }, [dataIsError, dataMessage, dispatch, navigate]);

  const closeMenu = () => {
    const toggle = document.getElementById("planit-header-dropper__toggle");
    if (toggle) toggle.checked = false;
  };

  const handleLogout = () => {
    closeMenu();
    dispatch(logout());
    navigate('/');
  };

  const hideComponentVisibility = () => { const toggle = document.getElementById("planit-header-dropper__toggle"); if (toggle) toggle.checked = false; };
  const ComponentVisibility = () => { return document.getElementById("planit-header-dropper__toggle").checked; };
  useOutsideAlerter("nav", insideComponentRef, toggleButtonRef, ComponentVisibility, hideComponentVisibility);

  return (
    <div className="dropper-space unclickable-background">
      <input id="planit-header-dropper__toggle" type="checkbox" />
      <label className={`dropper-btn${showHamburgerAnim ? ' hamburger-animate' : ''}`} htmlFor="planit-header-dropper__toggle" ref={toggleButtonRef}>
        <span></span>
      </label>
      <ul ref={insideComponentRef} className="dropper-box">
        {user ? (
          <li className="dropper-group">
            <Link className="dropper-link" to="/profile" onClick={closeMenu}>Profile</Link>
            <button className="dropper-link" type="button" onClick={handleLogout}>Log out</button>
          </li>
        ) : (
          <li className="dropper-group">
            <Link className="dropper-link" to="/login" onClick={closeMenu}>Log in</Link>
            <Link className="dropper-link" to="/register" onClick={closeMenu}>Create account</Link>
          </li>
        )}

        <li className="dropper-group">
          <Link className="dropper-link" to="/projects" onClick={closeMenu}>Projects</Link>
          <Link className="dropper-link" to="/about" onClick={closeMenu}>About</Link>
          <Link className="dropper-link" to="/support" onClick={closeMenu}>Support</Link>
          <Link className="dropper-link" to="/pricing" onClick={closeMenu}>Pricing</Link>
        </li>

        {user && (
          <li className="dropper-group">
            <Link className="dropper-link" to="/net" onClick={closeMenu}>Net</Link>
            {/* Also the phone route into Control, where the header switcher is
                hidden for lack of room. */}
            <Link className="dropper-link" to="/simple" onClick={closeMenu}>Simple</Link>
            <Link className="dropper-link" to="/plans" onClick={closeMenu}>Plans</Link>
            {/* Same word the header switcher uses for this room. */}
            <Link className="dropper-link" to="/market" onClick={closeMenu}>Market</Link>
          </li>
        )}

        {(isAdmin || isMuseVisitor) && (
          <li className="dropper-group">
            {isAdmin && <Link className="dropper-link" to="/admin" onClick={closeMenu}>Admin</Link>}
            {isMuseVisitor && <Link className="dropper-link" to="/muse" onClick={closeMenu}>Muse</Link>}
          </li>
        )}

        <li className="dropper-group dropper-group--theme">
          <button className="dropper-themebutton" type="button" onClick={props.handleThemeToggle}>
            {props.colTheme === 'dark-theme' ? 'Light mode' : 'Dark mode'}
          </button>
        </li>
      </ul>
    </div>
  )
}

export default HeaderDropper