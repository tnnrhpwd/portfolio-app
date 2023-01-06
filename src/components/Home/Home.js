import React, {useEffect, useState} from "react";
import BackgroundVideo from "./BackgroundVideo.js";
import NavBar from "./../NavBar/NavBar";
// import Utility from "./../Projects/Utility";

import lwwimg from './lww.png';
import marelliimg from './marelli.png';
import rcmimg from './rcm.png';
import shawimg from './shaw.png';
import fauimg from './fau.png';

import './Home.css';

const lwwlink = "https://www.lewisburgwater.org";
const marellilink = "https://www.marelli.com";
const rcmlink = "https://www.rcmindustries.com/";
const shawlink = "https://www.shawinc.com/";
const faulink = "https://www.faurecia.com/en";

function Home() {

  // state variable to record scroll location
  const [offsetY, setOffsetY] = useState(0);
  // method to update scroll location
  const handleScroll = () => {setOffsetY((window.pageYOffset/7.5).toFixed(1));}
  // method to call method to update scroll location
  useEffect(() =>{
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  },[])


  return (
    <>
      <NavBar />
      <div className="content">
  
        <div className="container-background">
          <BackgroundVideo yOff={offsetY}/>
        </div>

        <div className="container-scroll">
          <section className="section-tile">
            <div id="content-title">
            <div id="content-p1">
                <div id="text-title">Steven Tanner Hopwood</div>
                <br></br>
                <br></br>
                <br></br>
                <div id="text-body"> Let's build a brighter tomorrow! </div>
              </div>
            </div>
          </section>

          <section className="section-tile">
            <div id="content-p2">
              <div id="text-subtext"> Lean Manufacturing, Industrial Engineering, and Process Development  </div>
              {/* <div id="text-body"> Skills: </div> */}
              {/* <div id="text-subtext"> Lean Manufacturing, Process Improvement, and Project Management </div> */}
              <div id="text-body"></div>
              {/* <div id="text-subtext">Increasing conforming output and decreasing waste.</div> */}
              {/* <div id="text-body"></div> */}
              {/* <div className="utility-spc">
                <a className="utility-home-space" href="/projects">
                  <Utility type="html" tips={false}/>
                  <Utility type="react" tips={false}/>
                  <Utility type="css" tips={false}/>
                  <Utility type="firebase" tips={false}/>
                  <Utility type="netlify" tips={false}/>
                </a>
              </div> */}

            </div>
          </section>

          <section className="section-tile">
            <div id="content-p2">
              <div id="text-body"> Previous Employers: </div>
              <div className="home-spc">
                <a   rel="noopener noreferrer" target="_blank" href={marellilink} ><img className="home-spc-logos" src={marelliimg} alt="marelli logo" /></a> 
                <a   rel="noopener noreferrer" target="_blank" href={rcmlink} ><img className="home-spc-logos" src={rcmimg} alt="rcm logo" /></a> 
                <a   rel="noopener noreferrer" target="_blank" href={shawlink} ><img className="home-spc-logos" src={shawimg} alt="shaw logo" /></a> 
                <a   rel="noopener noreferrer" target="_blank" href={lwwlink} ><img className="home-spc-logos" src={lwwimg} alt="lewisburg wastewater logo" /></a> 
                <a   rel="noopener noreferrer" target="_blank" href={faulink} ><img className="home-spc-logos" src={fauimg} alt="faurecia logo" /></a> 
              </div>
            </div>
          </section>

          <section className="section-tile">
            <div id="content-p3">
              
              <a className="content-button" href="/projects">
                  <button id="content-button">Projects</button>
                </a>
                <div id="text-body"></div>
            </div>
          </section>

          <section className="section-tile">
            <div id="content-p4">
                <a className="content-button" href="/contact">
                  <button id="content-button">Contact</button>
                </a>
                <div id="text-body"></div>
            </div>
          </section>

          <section className="section-tile">
            <div id="content-p5">
              <div id="text-body">Thank you for visiting. </div>
            </div>
          </section>

        </div>
      </div>
    </>
  );
}
  
export default Home;
  