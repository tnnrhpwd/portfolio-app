import React, {useEffect, useState} from "react";
import BackgroundVideo from "./BackgroundVideo.js";
import NavBar from "./../NavBar/NavBar";
import './Home.css';

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
            <div id="text-body"></div>
              <div id="text-body"> Skills: </div>
              <div id="text-subtext"> Programming, Process Improvement, and Automation </div>
              <div id="text-body"></div>
              <div id="text-subtext">Increasing conforming output and decreasing waste.</div>
              <div id="text-body"></div>
            </div>
          </section>

          <section className="section-tile">
            <div id="content-p3">
              
              <a className="content-button" href="/projects">
                  <button id="content-button">My Projects</button>
                </a>
                <div id="text-body"></div>
            </div>
          </section>

          <section className="section-tile">
            <div id="content-p4">
                <a className="content-button" href="/contact">
                  <button id="content-button">Contact Me</button>
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
  