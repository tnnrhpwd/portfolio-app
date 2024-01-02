import React from 'react';
import Header from '../../../components/Header/Header';
import './About.css';
import linkedinimg from "../../Contact/linkedin.png";
import githubimg from "../../Contact/githubW.png";
import Footer from '../../../components/Footer/Footer';

function About() {

  return (<>
    <Header />
    <div className='about'>
      <div className='about-title'>
        About Simple by STHopwood
      </div>
      <>
        <div className='about-description'>
          <div className="about-name">
            Developed by Steven Tanner Hopwood
          </div>
          <div className="about-email">
            Business Inquiries: <a className="about-email-link" href="mailto:Steven.T.Hopwood@gmail.com">Steven.T.Hopwood@gmail.com</a>
          </div>
          <div className="about-body">
            <td className="about-social" onClick={()=> window.open("https://www.linkedin.com/in/sthopwood/", "_blank")}>
              <img className="about-linkedin" src={linkedinimg} alt=" linkedin logo" />
            </td>
            <td className="about-social" onClick={()=> window.open("https://github.com/tnnrhpwd", "_blank")}>
              <img className="about-github" src={githubimg} alt="github logo" />
            </td>
            <td className="about-social" onClick={()=> window.open("https://docs.google.com/document/d/1l8yCRlom5hw-SwOfZtpria_AUuXwcXpC/edit?usp=sharing&ouid=106668374323360993837&rtpof=true&sd=true", "_blank")}>
              <div className="about-resume">STH Resume</div>
            </td>
          </div>
        </div>
      </>
    </div>
    <Footer/>
</>)
}

export default About