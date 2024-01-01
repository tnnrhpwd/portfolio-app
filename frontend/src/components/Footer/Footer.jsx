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
              <a href="mailto:info@example.com">Contact Us</a> | 
              <a href="/privacy-policy">Privacy Policy</a> | 
              <a href="/terms-of-service">Terms of Service</a> | 
              <a href="/faq">FAQ</a> | 
              <a href="https://twitter.com/example" target="_blank" rel="noopener noreferrer">Follow us on Twitter</a>
          </div>
      </div>
    );
  }
}
  
  export default Footer;