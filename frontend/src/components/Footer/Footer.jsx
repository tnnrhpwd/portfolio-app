import React from "react";
import "./Footer.css";

function Footer() {
  return (
    <div className="footer-space">
        <div className="footer-space-text">
            Copyright © 2022-2024 Simple Inc. Developed by Steven Tanner Hopwood
        </div>
        <div className="footer-space-links">
            <a className="footer-space-link" href="/about">About Us</a> | 
            <a className="footer-space-link" href="/privacy">Privacy Policy</a> | 
            <a className="footer-space-link" href="/terms">Terms of Service</a>
        </div>
    </div>
  );}
  
  export default Footer;