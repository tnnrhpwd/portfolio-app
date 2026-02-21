import React from "react";
import Utility from "./Utility";
import Footer from '../../../components/Footer/Footer';
import NavBar from '../../../components/NavBar/NavBar';
import "./Projects.css";
import Header from '../../../components/Header/Header';

const projectData = [
  {
    id: 4,
    imgSrc: require("../../../assets/passgen.png"),
    alt: "the display for passgen",
    url: "/passgen",
    description: "Want a random password?",
    utilities: ["code", "html", "react", "css", "netlify"],
  },
  {
    id: 5,
    imgSrc: require("../../../assets/Annuities.jpeg"),
    alt: "the display for my cad projects",
    url: "/annuities",
    description: "Calculate the effect of compound interest on your investment.",
    utilities: ["code", "html", "react", "css", "netlify"],
  },
  {
    id: 2,
    imgSrc: require("../../../assets/Gfreq.png"),
    alt: "the display for gfreq",
    url: "/gfreq",
    description: "Analyze any audio from the microphone on your device.",
    utilities: ["code", "html", "react", "css", "netlify"],
  },
  {
    id: 1,
    imgSrc: require("../../../assets/wordle.png"),
    alt: "the display for wordle",
    url: "/wordle",
    description: "Wordle game clone with custom word length. Wordle Solver included.",
    utilities: ["code", "html", "react", "css", "netlify"],
  },
];

function Projects() {
  return (
    <>
      <Header />
      <div className="projects-space">
        <div className="projects-title">Projects</div>
        <div className="projects-description">Click each image to visit the project.</div>
        <div className="projects-holder">
          {projectData.map((project) => (
            <div className="projects-div" key={project.id}>
              <div className={`projects-p`}>
                <a href={project.url}>
                  <img id={`projects-p-img`} src={project.imgSrc} alt={project.alt} />
                </a>
              </div>
              <div className="projects-div-text">
                {project.description}
                <br /><br />
                <div className="utility-space">
                  {project.utilities.map((utility) => (
                    <Utility key={utility} type={utility} downurl={project.url} />
                  ))}
                </div>
              </div>
            </div>
          ))}
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
      <Footer />
    </>
  );
}

export default Projects;