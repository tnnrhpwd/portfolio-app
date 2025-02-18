import React from "react";
import "./Footer.css";

function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <div className="footer-space">
        <div className="footer-space-text">
            Copyright © 2022-{currentYear} Simple Inc.
        </div>
        <div className="footer-space-links">
            <a className="footer-space-link" href="/about">About Us</a> | 
            <a className="footer-space-link" href="/privacy">Privacy Policy</a> | 
            <a className="footer-space-link" href="/terms">Terms of Service</a>
        </div>
    </div>
  );
}

export default Footer;
