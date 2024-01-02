import React, {useEffect, useState} from "react";
import BackgroundVideo from "./BackgroundVideo.js";
import Header from "../../components/Header/Header.jsx";

import lwwimg from '../../assets/lww.png';
import marelliimg from '../../assets/marelli.png';
import rcmimg from '../../assets/rcm.png';
import shawimg from '../../assets/shaw.png';
import fauimg from '../../assets/fau.png';
import yfimg from '../../assets/yf.png';

import './Home.css';
import Footer from "../../components/Footer/Footer.jsx";

const lwwlink = "https://www.lewisburgwater.org";
const marellilink = "https://www.marelli.com";
const rcmlink = "https://www.rcmindustries.com/";
const shawlink = "https://www.shawinc.com/";
const faulink = "https://www.faurecia.com/en";
const yflink = "https://www.yanfeng.com/en";

const netlink = "/net";
const agendalink = "/agenda";
const passlink = "/passgen";
const annuitylink = "/annuities";
const soniclink = "/sonic";
const wordlelink = "/wordle";

function Home() {
  return (
    <>
      <Header />
      <div className="content">
        <div className="container-scroll">
          <section className="section-tile">
              <div id="content-tile">
                <div id="text-title">It's simple.</div>
                <div id="text-body"> Let's build a brighter tomorrow! </div>
                <div id="text-subtext"> Manufacturing, Engineering, and Process Development </div>
                <div id="text-about"><a href="/about">Learn more about us.</a></div>
                </div>
          </section>

          <section className="section-tile">
          <div id="content-tile">
            <div id="text-body"> Previous Employers: </div>
              <div className="home-spc">
                <a className="home-spc-logo" rel="noopener noreferrer" target="_blank" href={marellilink} ><img className="home-spc-logo-img" src={marelliimg} alt="marelli logo" /></a> 
                <a className="home-spc-logo" rel="noopener noreferrer" target="_blank" href={rcmlink} ><img className="home-spc-logo-img" src={rcmimg} alt="rcm logo" /></a> 
                <a className="home-spc-logo" rel="noopener noreferrer" target="_blank" href={shawlink} ><img className="home-spc-logo-img" src={shawimg} alt="shaw logo" /></a> 
                <a className="home-spc-logo" rel="noopener noreferrer" target="_blank" href={lwwlink} ><img className="home-spc-logo-img" src={lwwimg} alt="lewisburg wastewater logo" /></a> 
                <a className="home-spc-logo" rel="noopener noreferrer" target="_blank" href={faulink} ><img className="home-spc-logo-img" src={fauimg} alt="faurecia logo" /></a> 
                <a className="home-spc-logo" rel="noopener noreferrer" target="_blank" href={yflink} ><img className="home-spc-logo-img" src={yfimg} alt="yanfeng logo" /></a> 
              </div>
            </div>
            <div id="content-tile">
              <div id="text-body"> Tools: </div>
              <div className="home-spc">
                <a className="home-spc-tool" href={netlink} ><div className="home-spc-tool-text">{netlink}</div></a> 
                <a className="home-spc-tool" href={agendalink} ><div className="home-spc-tool-text">{agendalink}</div></a> 
                <a className="home-spc-tool" href={passlink} ><div className="home-spc-tool-text">{passlink}</div></a> 
                <a className="home-spc-tool" href={annuitylink} ><div className="home-spc-tool-text">{annuitylink}</div></a> 
                <a className="home-spc-tool" href={soniclink} ><div className="home-spc-tool-text">{soniclink}</div></a> 
                <a className="home-spc-tool" href={wordlelink} ><div className="home-spc-tool-text">{wordlelink}</div></a> 
              </div>
            </div>
          </section>
          <section className="section-tile">
            <div id="content-tile">
              <div id="text-body">Thank you for visiting. </div>
            </div>
          </section>

        </div>
        <Footer />
      </div>
    </>
  );
}
  
export default Home;
  