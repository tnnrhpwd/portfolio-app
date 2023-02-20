import React from "react";
// import pollsimg from "./polls.jpg";
import wordleSimg from "./wordle-solver.PNG";
import wordleimg from "./wordle.PNG";
import annuitiesimg from "./Annuities.jpeg";
// import draftingimg from "./drafting.jpg";
import ethanolimg from "./ethanol.PNG";
// import saloncwimg from "./saloncw.png";
import planitimg from './planit.png';
import sleepassistimg from './sleepassist.png';
import passgenimg from './passgen.png';

import Utility from "./Utility";

import Footer from '../Footer/Footer';
import BitcoinAPI from "../BitcoinAPI/BitcoinAPI.js";
import NavBar from '../NavBar/NavBar';
import "./Projects.css";

function Projects() {

    return (<>
      <NavBar />
      <div className="projects-space">
        <div className="projects-title">
          Projects
        </div>
        
        <div className="projects-description">
          Click each image to visit the project. 
        </div>
        <div></div>
        <div className="projects-holder">

          {/* <div className="projects-div">
            <div className="projects-p1">
              <a href="/pollbox">
                <img id="projects-p1-img" src={pollsimg} alt="the display for polling website"/>
              </a>
            </div>
            <div className="projects-div-text">
              Create your own survey for other site viewers. No sign-in required!
              <br/><br/>
              <div className="utility-space">
              <Utility type="code" url="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/PollBox"/>
                <Utility type="html"/>
                <Utility type="react"/>
                <Utility type="css"/>
                <Utility type="firebase"/>
                <Utility type="netlify"/>
              </div>
            </div>
          </div> */}
          
          <div className="projects-div">
            <div className="projects-p6">
              <a href="/wordle">
                <img id="projects-p6-img" src={wordleimg} alt="the display for wordle "/>
              </a>
            </div>
            <div className="projects-div-text">
              Try to guess the answer! You can also choose the word length.
              <br/><br/>
              <div className="utility-space">
                <Utility type="code" url="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/Wordle"/>
                <Utility type="html"/>
                <Utility type="react"/>
                <Utility type="css"/>
                <Utility type="netlify"/>
              </div>
            </div>
          </div>

          <div className="projects-div">
            <div className="projects-p10">
              <a href="/sleepassist">
                <img id="projects-p10-img" src={sleepassistimg} alt="the display for sleepassist "/>
              </a>
            </div>
            <div className="projects-div-text">
              Unsure what time to go to sleep?
              <br/><br/>
              <div className="utility-space">
                <Utility type="code" url="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/SleepAssist"/>
                <Utility type="html"/>
                <Utility type="react"/>
                <Utility type="css"/>
                <Utility type="netlify"/>
              </div>
            </div>
          </div>          
          
          <div className="projects-div">
            <div className="projects-p11">
              <a href="/passgen">
                <img id="projects-p11-img" src={passgenimg} alt="the display for passgen "/>
              </a>
            </div>
            <div className="projects-div-text">
              Want a random password?
              <br/><br/>
              <div className="utility-space">
                <Utility type="code" url="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/PassGen"/>
                <Utility type="html"/>
                <Utility type="react"/>
                <Utility type="css"/>
                <Utility type="netlify"/>
              </div>
            </div>
          </div>

          {/* <div className="projects-div">
            <div className="projects-p8">
              <a href="https://saloncw.netlify.app/"  rel="noopener noreferrer" target="_blank">
                <img id="projects-p8-img" src={saloncwimg} alt="the display for saloncw "/>
              </a>
            </div>
            <div className="projects-div-text">
              This was designed for a local salon to provide information to potential customers.
              <br/><br/>
              <div className="utility-space">

                <Utility type="code" url="https://github.com/tnnrhpwd/saloncw"/>
                <Utility type="html"/>
                <Utility type="react"/>
                <Utility type="css"/>
                <Utility type="netlify"/>
              </div>
            </div>
          </div> */}

          <div className="projects-div">
            <div className="projects-p5">
              <a href="/annuities">
                <img id="projects-p5-img" src={annuitiesimg} alt="the display for my cad projects"/>
              </a>
            </div>
            <div className="projects-div-text">
              Calculate the effect of compound interest on your investment.
              <br/><br/>
              <div className="utility-space">
                <Utility type="code" url="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/Annuities"/>
                <Utility type="html"/>
                <Utility type="react"/>
                <Utility type="css"/>
                <Utility type="netlify"/>
              </div>
            </div>
          </div>

          <div className="projects-div">
            <div className="projects-p2">
              <a href="/wordlesolver">
                <img id="projects-p2-img" src={wordleSimg} alt="the display for wordle solver website"/>
              </a>
            </div>
            <div className="projects-div-text">
              Find the answer to any Wordle puzzle.
              <br/><br/>
              <div className="utility-space">
                <Utility type="code" url="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/WordleSolver"/>
                <Utility type="html"/>
                <Utility type="react"/>
                <Utility type="css"/>
                <Utility type="netlify"/>
              </div>
            </div>
          </div>

          {/* <div className="projects-div">
            <div className="projects-p9">
              <a href="https://mern-planit-app.herokuapp.com/"  rel="noopener noreferrer" target="_blank">
                <img id="projects-p9-img" src={planitimg} alt="the display for my planit project"/>
              </a>
            </div>
            <div className="projects-div-text">
              Do you have a plan you want to share with the world?
              <br/><br/> ( Work-in-Progress ) <br/>( Please wait for Heroku initial load )
              <br/><br/>
              <div className="utility-space">
                <Utility type="code" url="https://github.com/tnnrhpwd/mern-planit-app"/>
                <Utility type="html"/>
                <Utility type="react"/>
                <Utility type="css"/>
                <Utility type="heroku"/>
                <Utility type="mongo"/>
                <Utility type="node"/>
              </div>
            </div>
          </div> */}
          
          <div className="projects-div">
            <div className="projects-p7">
              <a href="/ethanol">
                <img id="projects-p7-img" src={ethanolimg} alt="the display for ethanol calculator"/>
              </a>
            </div>
            <div className="projects-div-text">
              Calculates the standard drinks in any alcoholic volume.
              <br/><br/>
              <div className="utility-space">
                <Utility type="code" url="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/Ethanol"/>
                <Utility type="html"/>
                <Utility type="react"/>
                <Utility type="css"/>
                <Utility type="netlify"/>
              </div>
            </div>
          </div>
          <div className="projects-div">
            <div className="projects-p3">
              <BitcoinAPI/>
            </div>
            <div className="projects-div-text">
            <br/>
              This displays the current bitcoin price using the CoinDesk API. Click the price to call an update.
              <br/><br/>
              <div className="utility-space">
                <Utility type="code" url="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/BitcoinAPI"/>
                <Utility type="html"/>
                <Utility type="react"/>
                <Utility type="css"/>
                <Utility type="netlify"/>
              </div>
            </div>
          </div>

          {/* <div className="projects-div">
            <div className="projects-p4">
              <a href="/drafting">
                <img id="projects-p4-img" src={draftingimg} alt="the display for my cad projects"/>
              </a>
            </div>
            <div className="projects-div-text">
              This displays my previous drafting work in an image slideshow.
              <br/><br/>
              <div className="utility-space">
                <Utility type="code" url="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/Drafting"/>
                <Utility type="html"/>
                <Utility type="react"/>
                <Utility type="css"/>
                <Utility type="netlify"/>
              </div>
            </div>
          </div> */}
        </div>

        <div></div>
        <div className="projects-resume">
          <a className="projects-resume-inside" href="https://docs.google.com/document/d/1l8yCRlom5hw-SwOfZtpria_AUuXwcXpC/edit?usp=sharing&ouid=106668374323360993837&rtpof=true&sd=true" rel="noopener noreferrer" target="_blank">
                  <button id="projects-resume-button">STH RESUME</button>
          </a>
        </div>
        <div></div>
        <div className="projects-source">
          <a className="projects-source-inside" href="https://github.com/tnnrhpwd/portfolio-app" rel="noopener noreferrer" target="_blank">
                  <button id="projects-source-button">This Website's Github Repo</button>
          </a>
        </div>
        <div></div>
        

      </div>
      <Footer/>
    </>);
  }
  
  export default Projects;

