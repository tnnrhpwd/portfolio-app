import React, { useEffect, useState } from "react";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import { useSelector, useDispatch } from 'react-redux';
import { getPublicData } from '../../features/data/dataSlice.js';
import './Home.css';

const links = {
    net: "/net",
    agenda: "/agenda",
    admin: "/admin",
    passgen: "/passgen",
    annuities: "/annuities",
    sonic: "/sonic",
    wordle: "/wordle",
    simple: "/simple",
    plans: "/plans",
    login: "/login",
};

function Home() {
    const dispatch = useDispatch();
    const [displayedText, setDisplayedText] = useState("");
    const [isTyping, setIsTyping] = useState(true);
    const [animationPhase, setAnimationPhase] = useState(0);

    const { user } = useSelector(
        (state) => state.data
    );

    const titleText = "It's simple.";
    
    // Typewriter effect for the main title
    useEffect(() => {
        let timeout;
        if (isTyping && displayedText.length < titleText.length) {
            timeout = setTimeout(() => {
                setDisplayedText(titleText.substring(0, displayedText.length + 1));
            }, 100);
        } else if (isTyping && displayedText.length === titleText.length) {
            setIsTyping(false);
            setTimeout(() => setAnimationPhase(1), 500);
        }
        return () => clearTimeout(timeout);
    }, [displayedText, isTyping, titleText]);

    useEffect(() => {
        dispatch(getPublicData({ data: { text: "Action" } })).unwrap();
    }, [dispatch]);

    return (
        <>
            <Header />
            <div className="container">
                {/* Floating elements for visual interest */}
                <div className="floating-shapes">
                    <div className="floating-circle floating-circle-1"></div>
                    <div className="floating-circle floating-circle-2"></div>
                    <div className="floating-circle floating-circle-3"></div>
                </div>
                
                <section className="section-tile hero-section">
                    <div id="content-tile">
                        <div id="text-title" className="typewriter">
                            {displayedText}<span className="cursor">|</span>
                        </div>
                        <div id="text-body" className={`fade-in-up ${animationPhase >= 1 ? 'visible' : ''}`}>
                            Let's build a brighter tomorrow!
                        </div>
                        <div id="text-subtext" className={`fade-in-up ${animationPhase >= 1 ? 'visible' : ''}`}>
                            Manufacturing, Engineering, and Process Development
                        </div>
                        <div id="text-about" className={`fade-in-up ${animationPhase >= 1 ? 'visible' : ''}`}>
                            <a href="/about" className="glow-link">Learn more about us.</a>
                        </div>
                    </div>
                </section>

                <section className="section-tile links-section">
                    <div id="content-tile">
                        <div id="text-body" className="section-header"> Pages: </div>
                        <div className="home-spc">
                            {(user && user._id && user._id.toString() === '6770a067c725cbceab958619') && 
                                <a className="home-spc-tool animate-in" href={links.admin} style={{animationDelay: '0.1s'}}>
                                    <div className="home-spc-tool-text">{links.admin}</div>
                                </a>}
                            <a className="home-spc-tool animate-in" href={links.annuities} style={{animationDelay: '0.2s'}}>
                                <div className="home-spc-tool-text">{links.annuities}</div>
                            </a>
                            {user ? <>
                                <a className="home-spc-tool animate-in" href={links.net} style={{animationDelay: '0.3s'}}>
                                    <div className="home-spc-tool-text">{links.net}</div>
                                </a>
                                <a className="home-spc-tool animate-in" href={links.plans} style={{animationDelay: '0.4s'}}>
                                    <div className="home-spc-tool-text">{links.plans}</div>
                                </a>
                            </> : 
                                <a className="home-spc-tool animate-in login-highlight" href={links.login} style={{animationDelay: '0.3s'}}>
                                    <div className="home-spc-tool-text">Login for full access</div>
                                </a>
                            }
                        </div>
                    </div>
                    
                    <div id="content-tile">
                        <div id="text-body" className="section-header"> Apps: </div>
                        <div className="home-spc">
                            <a className="home-spc-tool animate-in app-highlight" href={links.simple} style={{animationDelay: '0.5s'}}>
                                <div className="home-spc-tool-text">
                                    <span className="app-icon">💻</span>
                                    Simple (Windows)
                                </div>
                            </a>
                        </div>
                    </div>
                </section>

                <section className="section-tile thank-you-section">
                    <div id="content-tile">
                        <div id="text-body" className="thank-you-text">
                            Thank you for visiting.
                            <span className="heart-pulse">❤️</span>
                        </div>
                    </div>
                </section>
                
                <Footer />
            </div>
        </>
    );
}

export default Home;
