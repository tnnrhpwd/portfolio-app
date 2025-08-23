import React from 'react';
import Header from '../../../components/Header/Header';
import './About.css';
import linkedinimg from "../../Contact/linkedin.png";
import githubimg from "../../Contact/githubW.png";
import Footer from '../../../components/Footer/Footer';

function About() {
  const technicalSkills = [
    'JavaScript', 'ReactJS', 'NodeJS', 'HTML/CSS', 'Python', 'C# .Net',
    'ExpressJS', 'AWS', 'CI/CD', 'Git', 'VSCode', 'Java'
  ];

  const engineeringSkills = [
    'AutoCAD', 'SolidWorks', 'Autodesk Inventor', 'Revit', 'ArchiCAD',
    'ProModel', 'Microsoft Visio', 'SAP', 'PLM', 'Cognex Vision Suite'
  ];

  const businessSkills = [
    'Lean Manufacturing', 'Six Sigma Green Belt', 'Process Optimization',
    'Cost Reduction', 'Project Management', '5S Implementation', 'PFMEA'
  ];

  return (<>
    <div className='about'>
      <Header />
      <div className='about-container'>
        <div className='about-hero'>
          <div className='about-title'>
            Steven Tanner Hopwood
          </div>
          <div className='about-subtitle'>
            Advanced Manufacturing Engineer
          </div>
        </div>

        <div className='about-content'>
          <section className='about-section'>
            <h2 className='section-title'>Professional Summary</h2>
            <div className='about-text'>
              <p>
                <strong>Advanced Manufacturing Engineer</strong> at Yanfeng Interiors with <strong>$250K+ in proven cost savings</strong>. 
              </p>
            </div>
          </section>

          <section className='about-section'>
            <h2 className='section-title'>Key Achievements</h2>
            <div className='achievements-grid'>
              <div className='achievement-card'>
                <div className='achievement-number'>$239K+</div>
                <div className='achievement-text'>Direct cost savings</div>
              </div>
              <div className='achievement-card'>
                <div className='achievement-number'>$45K</div>
                <div className='achievement-text'>Annual materials savings</div>
              </div>
              <div className='achievement-card'>
                <div className='achievement-number'>3+ Years</div>
                <div className='achievement-text'>Manufacturing experience</div>
              </div>
              <div className='achievement-card'>
                <div className='achievement-number'>Green Belt</div>
                <div className='achievement-text'>Six Sigma certified</div>
              </div>
            </div>
          </section>

          <section className='about-section'>
            <h2 className='section-title'>Technical Expertise</h2>
            <div className='skills-categories'>
              <div className='skill-category'>
                <h3>Software Development</h3>
                <div className='skills-container'>
                  {technicalSkills.map((skill, index) => (
                    <span key={index} className='skill-tag'>
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
              
              <div className='skill-category'>
                <h3>Engineering & CAD</h3>
                <div className='skills-container'>
                  {engineeringSkills.map((skill, index) => (
                    <span key={index} className='skill-tag engineering'>
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
              
              <div className='skill-category'>
                <h3>Business & Process</h3>
                <div className='skills-container'>
                  {businessSkills.map((skill, index) => (
                    <span key={index} className='skill-tag business'>
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className='about-section'>
            <h2 className='section-title'>What I Do</h2>
            <div className='services-grid'>
              <div className='service-card'>
                <h3>Manufacturing Engineering</h3>
                <p>Process optimization, tooling design, PFMEA, and OEM launches.</p>
              </div>
              <div className='service-card'>
                <h3>Lean Implementation</h3>
                <p>Six Sigma Green Belt. 5S workshops, SMED, efficiency improvements.</p>
              </div>
              <div className='service-card'>
                <h3>Full-Stack Development</h3>
                <p>React, Node.js, Python, C#. Modern web applications.</p>
              </div>
              <div className='service-card'>
                <h3>Process Automation</h3>
                <p>Vision systems, automated inspection, paperless workflows.</p>
              </div>
            </div>
          </section>

          <section className='about-section'>
            <h2 className='section-title'>Featured Projects</h2>
            <div className='projects-grid'>
              <div className='project-card'>
                <h3>C# Simple Automation</h3>
                <p>Desktop automation application built with C# for streamlining repetitive tasks.</p>
                <button 
                  className='project-link'
                  onClick={() => window.open("https://github.com/tnnrhpwd/C-Simple", "_blank")}
                >
                  View on GitHub →
                </button>
              </div>
              <div className='project-card'>
                <h3>Portfolio Web App</h3>
                <p>Full-stack React application with Node.js backend showcasing engineering and development skills.</p>
                <button 
                  className='project-link'
                  onClick={() => window.open("https://github.com/tnnrhpwd/portfolio-app", "_blank")}
                >
                  View on GitHub →
                </button>
              </div>
            </div>
          </section>

          <section className='about-section'>
            <h2 className='section-title'>Education</h2>
            <div className='education-list'>
              <div className='education-item'>
                <h3>Six Sigma Green Belt</h3>
                <p>May 2023</p>
              </div>
              <div className='education-item'>
                <h3>BS Engineering Technology Management</h3>
                <p>University of Tennessee at Chattanooga | 2017-2021</p>
              </div>
            </div>
          </section>

          <section className='about-section'>
            <h2 className='section-title'>Get in Touch</h2>
            <div className='contact-info'>
              <div className="about-email">
                <span>Business Inquiries: </span>
                <a className="about-email-link" href="mailto:Steven.T.Hopwood@gmail.com">
                  Steven.T.Hopwood@gmail.com
                </a>
              </div>
              
              <div className="social-links">
                <button 
                  className="social-button linkedin"
                  onClick={() => window.open("https://www.linkedin.com/in/sthopwood/", "_blank")}
                  aria-label="Visit LinkedIn profile"
                >
                  <img src={linkedinimg} alt="LinkedIn" />
                  <span>LinkedIn</span>
                </button>
                
                <button 
                  className="social-button github"
                  onClick={() => window.open("https://github.com/tnnrhpwd", "_blank")}
                  aria-label="Visit GitHub profile"
                >
                  <img src={githubimg} alt="GitHub" />
                  <span>GitHub</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
      <Footer/>
    </div>
</>)
}

export default About