import React, { useEffect, useState } from "react";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import { useSelector, useDispatch } from 'react-redux';
import { getPublicData } from '../../features/data/dataSlice.js';
import './Home.css';

const links = {
    about: "/about",
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
    profile: "/profile",
    support: "/support",
};

function Home() {
    const dispatch = useDispatch();
    const [displayedText, setDisplayedText] = useState("");
    const [isTyping, setIsTyping] = useState(true);
    const [animationPhase, setAnimationPhase] = useState(0);
    const [showWordlePopup, setShowWordlePopup] = useState(false);

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

    // Show Wordle popup after 5 seconds
    // useEffect(() => {
    //     const timer = setTimeout(() => {
    //         setShowWordlePopup(true);
    //     }, 5000);
        
    //     return () => clearTimeout(timer);
    // }, []);

    const handleClosePopup = () => {
        setShowWordlePopup(false);
    };

    return (
        <>
            <Header />
            <main id="main-content" className="container">
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
                            <a href={links.about} className="glow-link">Learn more about us.</a>
                        </div>
                    </div>
                </section>

                <section className="section-tile links-section">
                    <div id="content-tile">
                        <div id="text-body" className="section-header"> Pages: </div>
                        <div className="home-spc">
                            {/* Core Information */}
                            <a className="home-spc-tool animate-in" href={links.about} style={{animationDelay: '0.1s'}}>
                                <div className="home-spc-tool-text">{links.about}</div>
                            </a>
                            <a className="home-spc-tool animate-in" href={links.support} style={{animationDelay: '0.15s'}}>
                                <div className="home-spc-tool-text">{links.support}</div>
                            </a>
                            
                            {/* Financial Tools */}
                            <a className="home-spc-tool animate-in" href={links.annuities} style={{animationDelay: '0.2s'}}>
                                <div className="home-spc-tool-text">{links.annuities}</div>
                            </a>
                            {user && 
                                <a className="home-spc-tool animate-in" href={links.plans} style={{animationDelay: '0.25s'}}>
                                    <div className="home-spc-tool-text">{links.plans}</div>
                                </a>
                            }
                            
                            {/* Utilities & Tools */}
                            {user && <>
                                <a className="home-spc-tool animate-in" href={links.passgen} style={{animationDelay: '0.3s'}}>
                                    <div className="home-spc-tool-text">{links.passgen}</div>
                                </a>
                                <a className="home-spc-tool animate-in" href={links.net} style={{animationDelay: '0.35s'}}>
                                    <div className="home-spc-tool-text">{links.net}</div>
                                </a>
                            </>}
                            
                            {/* Games & Entertainment */}
                            <a className="home-spc-tool animate-in" href={links.wordle} style={{animationDelay: '0.4s'}}>
                                <div className="home-spc-tool-text">{links.wordle}</div>
                            </a>
                            
                            {/* Admin (Special Access) */}
                            {(user && user._id && user._id.toString() === '6770a067c725cbceab958619') && 
                                <a className="home-spc-tool animate-in" href={links.admin} style={{animationDelay: '0.45s'}}>
                                    <div className="home-spc-tool-text">{links.admin}</div>
                                </a>}
                            
                            {/* Login prompt for non-authenticated users */}
                            {!user && 
                                <a className="home-spc-tool animate-in login-highlight" href={links.login} style={{animationDelay: '0.5s'}}>
                                    <div className="home-spc-tool-text">Login for full access</div>
                                </a>
                            }
                        </div>
                    </div>
                    
                    <div id="content-tile">
                        <div id="text-body" className="section-header"> Apps: </div>
                        <div className="home-spc">
                            <a className="home-spc-tool animate-in app-highlight" href={links.simple} style={{animationDelay: '0.55s'}}>
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
                
                {/* Wordle Welcome Popup */}
                {showWordlePopup && (
                    <div className="wordle-popup">
                        <button className="popup-close" onClick={handleClosePopup}>×</button>
                        <div className="popup-content">
                            <div className="popup-icon">🎯</div>
                            <div className="popup-text">
                                <span className="popup-title">Try Wordle?</span>
                                <span className="popup-subtitle">Test your word skills!</span>
                            </div>
                        </div>
                        <div className="popup-buttons">
                            <a href="/wordle" className="popup-btn primary">
                                Play
                            </a>
                        </div>
                    </div>
                )}
            </main>
        </>
    );
}

export default Home;
