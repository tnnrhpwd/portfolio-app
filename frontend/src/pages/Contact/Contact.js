import React from "react";
import linkedinimg from "./linkedin.png";
import githubimg from "./githubW.png";
import Footer from '../../components/Footer/Footer';
import NavBar from '../../components/NavBar/NavBar';
import "./Contact.css";

function Contact() {
    return (
    <>
      <NavBar/>
      <div className="contact-space">
        <div className="contact-title">
            Contact
        </div>
        <div className="contact-name">
          Steven Tanner Hopwood
        </div>
        <div className="contact-email">
          Steven.T.Hopwood@gmail.com
        </div>
        <div className="contact-body">
          <td className="contact-social" onClick={()=> window.open("https://www.linkedin.com/in/sthopwood/", "_blank")}>
            <img className="contact-linkedin" src={linkedinimg} alt=" linkedin logo" />
          </td>
          <td className="contact-social" onClick={()=> window.open("https://github.com/tnnrhpwd", "_blank")}>
            <img className="contact-github" src={githubimg} alt="github logo" />
          </td>
          <td className="contact-social" onClick={()=> window.open("https://github.com/tnnrhpwd", "_blank")}>
            Resume
          </td>
        </div>
        <div className="contact-body">
          <form name="contact" method="post" data-netlify="true" data-netlify-honeypot="bot-field" netlify>
          <input type="hidden" name="form-name" value="contact" />  
            <div className="contact-input-space">
              <label className="contact-input-text">Name </label>
              <input className="contact-input-contact" type="text" name="name" />
            </div>
            <div className="contact-input-space">
              <label className="contact-input-text">Email (optional) </label>
              <input className="contact-input-contact" type="text" name="email" />
            </div>
            <div className="contact-input-message-space">
              <label className="contact-input-text">Message </label>
              <textarea className="contact-input-message" name="message"></textarea>
            </div>
            <div className="contact-link-div">
              <button id="contact-link" type="submit">Submit</button>
            </div>
          </form>
        </div>
        <Footer/>
      </div>
    </>);
  }
  
  export default Contact;
  