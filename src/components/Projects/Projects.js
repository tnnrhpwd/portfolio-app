import React from "react";
import "./Projects.css";
import pollsimg from "./polls.jpg";
import wordleSimg from "./wordle-solver.PNG";
import annuitiesimg from "./Annuities.jpeg";
import draftingimg from "./drafting.jpg";

import Footer from './../Footer/Footer';
import BitcoinAPI from "./../BitcoinAPI/BitcoinAPI.js";

function Projects() {
    return (<>
      <div className="projects-space">
        <div className="projects-title">
          Projects
        </div>
        <div className="projects-description">
          Click each project for more information.
        </div>
        
        <div className="projects-resume">
          <a className="projects-resume-inside" href="https://docs.google.com/document/d/1l8yCRlom5hw-SwOfZtpria_AUuXwcXpC/edit?usp=sharing&ouid=106668374323360993837&rtpof=true&sd=true">
                  <button id="projects-resume-button">STH Resume⚡</button>
          </a>
        </div>
        <div></div>

        <div className="projects-p1">
        
        <a href="/pollbox">
          <img id="projects-p1-img" src={pollsimg} alt="the display for polling website"/>
        </a>
        <div className="projects-p1-text">
        </div>
      </div>
      <div></div>

        <div className="projects-p5">
          <a href="/annuities">
            <img id="projects-p5-img" src={annuitiesimg} alt="the display for my cad projects"/>
          </a>
        </div>
        <div></div>

        <div className="projects-p2">
          <td onClick={()=> window.open("https://sthopwood.weebly.com/wordlesolver.html")}>
            <img id="projects-p2-img" src={wordleSimg} alt="the display for wordle solver website"/>
          </td>
        </div>
        <div></div>
        <div className="projects-p3">
          <BitcoinAPI/>
        </div>
        <div></div>
        <div className="projects-p4">
          <a href="/drafting">
            <img id="projects-p4-img" src={draftingimg} alt="the display for my cad projects"/>
          </a>
        </div>
        <div></div>
        

      </div>
      <Footer/>
    </>);
  }
  
  export default Projects;

