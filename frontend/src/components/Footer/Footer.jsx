import React from "react";
import { Link } from "react-router-dom";
import "./Footer.css";

function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="footer-space modern-footer">
      <div className="footer-space-text">
        <span className="footer-copyright">
          Copyright © 2022-{currentYear} Simple Inc.
        </span>
      </div>
      <div className="footer-space-links">
        <Link className="footer-space-link" to="/about">About Us</Link>
        <Link className="footer-space-link" to="/privacy">Privacy Policy</Link>
        <Link className="footer-space-link" to="/terms">Terms of Service</Link>
      </div>
    </footer>
  );
}

export default Footer;
