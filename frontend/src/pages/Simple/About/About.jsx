import React from 'react';
import Header from '../../../components/Header/Header';
import './About.css';
import linkedinimg from "../../Contact/linkedin.png";
import githubimg from "../../Contact/githubW.png";
import Footer from '../../../components/Footer/Footer';

function About() {

  return (<>
    <div className='about'>
      <Header />
      <div className='about-title'>
        About this App
      </div>
      <>
        <div className='about-description'>
          <div className="about-name">
            <div className="about-name-container">
              <div>Developed by</div>
              <div>Steven Tanner Hopwood</div>
            </div>
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
          </div>
        </div>
      </>
      <Footer/>
    </div>
</>)
}

export default About