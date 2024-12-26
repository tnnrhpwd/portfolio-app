import React, {useEffect, useState} from "react";
import BackgroundVideo from "./BackgroundVideo.js";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import { useSelector, useDispatch } from 'react-redux'      // access state variables
import './Home.css';
const lwwlink = "https://www.lewisburgwater.org";
const marellilink = "https://www.marelli.com";
const rcmlink = "https://www.rcmindustries.com/";
const shawlink = "https://www.shawinc.com/";
const faulink = "https://www.faurecia.com/en";
const yflink = "https://www.yanfeng.com/en";

const links = {
  net: "/net",
  agenda: "/agenda",
  passgen: "/passgen",
  annuities: "/annuities",
  sonic: "/sonic",
  wordle: "/wordle",
  simple: "/simple",
  plans: "/plans"
};

function Home() {

  const { user, data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage } = useSelector(     // select values from state
  (state) => state.data
  )

  return (
    <>
      <Header />
        <div className="container">
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
              <div id="text-body"> Pages: </div>
              <div className="home-spc">
                <a className="home-spc-tool" href={links.passgen} ><div className="home-spc-tool-text">{links.passgen}</div></a> 
                <a className="home-spc-tool" href={links.annuities} ><div className="home-spc-tool-text">{links.annuities}</div></a> 
                {user && <a className="home-spc-tool" href={links.net} ><div className="home-spc-tool-text">{links.net}</div></a>}
                {user && <a className="home-spc-tool" href={links.plans} ><div className="home-spc-tool-text">{links.plans}</div></a>}
              </div>
            </div>
             <div id="content-tile">
              <div id="text-body"> Apps: </div>
              <div className="home-spc">
                <a className="home-spc-tool" href={links.simple}>
                  <div className="home-spc-tool-text">Simple (Windows)</div>
                </a> 
              </div>
            </div>
          </section>
          <section className="section-tile">
            <div id="content-tile">
              <div id="text-body">Thank you for visiting. </div>
            </div>
          </section>
          <Footer />
        </div>
    </>
  );
}

export default Home;