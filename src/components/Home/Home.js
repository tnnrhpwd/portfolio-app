import React, {useEffect, useState} from "react";
import './Home.css';
import BackgroundVideo from "./BackgroundVideo.js";
import Faderz from "../Faderz/Faderz.js";
import Footer from '../Footer/Footer.js';

// import { gsap } from "gsap";
// import ScrollTrigger from "gsap/ScrollTrigger";

// var bgVideo;
// let rendNum = 0;
// let frameNum = 0;

function Home() {

  // state variable to record scroll location
  const [offsetY, setOffsetY] = useState(0);
  // method to update scroll location
  const handleScroll = () => {setOffsetY((window.pageYOffset/7.5).toFixed(1));}
  // method to call method to update scroll location
  useEffect(() =>{
        window.addEventListener('scroll', handleScroll);
    // vid.currentTime=offsetY;
    return () => window.removeEventListener('scroll', handleScroll);
  },[])

  // useEffect(()=>{
  //   rendNum++;
  //   console.log("renders="+rendNum);

    // if(rendNum==2){
    //   // variable to store video
    //   bgVideo = document.getElementById("video1");
    //   bgVideo.currentTime = 0;


    //   gsap.registerPlugin(ScrollTrigger);

    //   let sections = gsap.utils.toArray(".section-tile");
    //   sections.forEach((tile,i) => {

    //     const anim = gsap.fromTo(bgVideo, {currentTime: 18 * i},{
    //       scrollTrigger: {
    //         trigger:tile,
    //         scrub:2,
    //         start: "top bottom",
    //         end: "bottom bottom",
    //       },
    //       currentTime:18 * (i+1),
    //       duration:1,
    //       ease:"none",
    //     });
    //     ScrollTrigger.create({
    //       trigger:tile,
    //       animation: anim,
    //       // Uncomment these to see how they affect the ScrollTrigger
    //       markers: true,
    //       start: "top center",
    //       end: "top 100px",
    //       toggleClass: "active",
    //       pin: true,
    //       scrub: 1,
    //       // onUpdate: self => {
    //       //   console.log("progress:", self.progress.toFixed(3), "direction:", self.direction, "velocity", self.getVelocity());
    //       // }
    //     });
    //   });
    // }
  //   if(rendNum>3){
  //     frameNum = bgVideo.currentTime;
  //   }
  // },[offsetY]);


  return (
    <div className="content">
      <div className="container-background">
        <BackgroundVideo yOff={offsetY}/>
      </div>
      
      <div className="container-scroll">
        <section className="section-tile">
          <div id="content-title">
            <div id="text-title">Steven Tanner Hopwood</div>
            {/* <Faderz text="fadetext" yOff={offsetY} tIn={10} tOut={200}/> */}
          </div>
        </section>

        {/* <section className="section-tile">
          <div id="content-p1">
            <div id="text-body">Industrial Engineer 
            <br></br>
            + Software Developer</div>
          </div>
        </section> */}

        <section className="section-tile">
          <div id="content-p2">
          <div id="text-body"></div>
            <div id="text-body"> Let's build a brighter tomorrow! </div>
            <br></br>
            <br></br>
            <div id="text-body"> Skills: </div>
            <div id="text-subtext"> Programming, Process Improvement, and Automation </div>
            <div id="text-body"></div>
            <div id="text-subtext">Increasing conforming production and decreasing waste.</div>
            <div id="text-body"></div>
          </div>
        </section>

        <section className="section-tile">
          <div id="content-p3">
            {/* <div id="text-body">Y Offset={offsetY}</div> */
            /* <div id="text-body">Scroll Renders={rendNum}</div>
            <div id="text-body">Video Frame Num={frameNum}</div> */}
            {/* <div id="text-body">Check out some of my projects.</div> */}
            <a className="content-button" href="/projects">
                <button id="content-button">My Projects</button>
              </a>
              <div id="text-body"></div>
          </div>
        </section>

        <section className="section-tile">
          <div id="content-p4">
            {/* <div id="text-body"> Already have a project in mind?  </div> */}
              <a className="content-button" href="/contact">
                <button id="content-button">Contact Me</button>
              </a>
              <div id="text-body"></div>
          </div>
        </section>

        <section className="section-tile">
          <div id="content-p5">
            <div id="text-body">Thank you for visiting. </div>
            <div id="text-subtext"> -- Steven Tanner Hopwood </div>
          </div>
        </section>
    


      </div>
    </div>
  );
}
  
export default Home;
  