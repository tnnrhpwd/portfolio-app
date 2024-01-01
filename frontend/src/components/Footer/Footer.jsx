import React from "react";
import "./Footer.css";

function Footer(props) {
  if(props.transparent==="1"){
    return (
      <div className="footer-space-transparent">
          Copyright © 2022-2024 Simple Inc. Developed by Steven Tanner Hopwood
      </div>
    );
  } else{
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
    );
  }
}
  
  export default Footer;