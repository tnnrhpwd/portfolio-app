import React from "react";
import pollsimg from "./polls.jpg";
import wordleSimg from "./wordle-solver.PNG";
import wordleimg from "./wordle.PNG";
import annuitiesimg from "./Annuities.jpeg";
import draftingimg from "./drafting.jpg";
import ethanolimg from "./ethanol.PNG";
import Footer from './../Footer/Footer';
import BitcoinAPI from "./../BitcoinAPI/BitcoinAPI.js";
import NavBar from './../NavBar/NavBar';
import "./Projects.css";

function Projects() {

    return (<>
      <NavBar />
      <div className="projects-space">
        <div className="projects-title">
          Projects
        </div>
        
        <div className="projects-description">
          Click each project for more information.
        </div>
        <div></div>
        <div className="projects-holder">

          <div className="projects-p1">
            <a href="/pollbox">
              <img id="projects-p1-img" src={pollsimg} alt="the display for polling website"/>
            </a>
          </div>


          <div className="projects-p5">
            <a href="/annuities">
              <img id="projects-p5-img" src={annuitiesimg} alt="the display for my cad projects"/>
            </a>
          </div>


          <div className="projects-p6">
            <a href="/wordle">
              <img id="projects-p6-img" src={wordleimg} alt="the display for wordle "/>
            </a>
          </div>


          <div className="projects-p2">
            <a href="/wordlesolver">
              <img id="projects-p2-img" src={wordleSimg} alt="the display for wordle solver website"/>
            </a>
          </div>


          <div className="projects-p7">
            <a href="/ethanol">
              <img id="projects-p7-img" src={ethanolimg} alt="the display for ethanol calculator"/>
            </a>
          </div>


          <div className="projects-p3">
            <BitcoinAPI/>
          </div>

          <div className="projects-p4">
            <a href="/drafting">
              <img id="projects-p4-img" src={draftingimg} alt="the display for my cad projects"/>
            </a>
          </div>

          
        </div>

        <div></div>
        <div className="projects-resume">
          <a className="projects-resume-inside" href="https://docs.google.com/document/d/1l8yCRlom5hw-SwOfZtpria_AUuXwcXpC/edit?usp=sharing&ouid=106668374323360993837&rtpof=true&sd=true" rel="noreferrer" target="_blank">
                  <button id="projects-resume-button">⚡ STH RESUME ⚡</button>
          </a>
        </div>
        <div></div>
        <div className="projects-source">
          <a className="projects-source-inside" href="https://github.com/tnnrhpwd/portfolio-app" rel="noreferrer" target="_blank">
                  <button id="projects-source-button">This Website's Github Repo</button>
          </a>
        </div>
        <div></div>
        

      </div>
      <Footer/>
    </>);
  }
  
  export default Projects;

