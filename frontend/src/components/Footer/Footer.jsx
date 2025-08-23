import React from "react";
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
        <a className="footer-space-link" href="/about">About Us</a>
        <a className="footer-space-link" href="/privacy">Privacy Policy</a>
        <a className="footer-space-link" href="/terms">Terms of Service</a>
      </div>
    </footer>
  );
}

export default Footer;
