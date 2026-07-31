import React, { useEffect, useState } from "react";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import SEO, { SITE_URL } from "../../components/SEO/SEO.jsx";
import { useSelector, useDispatch } from 'react-redux';
import { getUserUsage } from '../../features/data/dataSlice.js';
import dataService from '../../features/data/dataService.js';
import './Home.css';

const links = {
    about: "/about",
    net: "/net",
    agenda: "/agenda",
    admin: "/admin",
    iq: "/iq",
    passgen: "/passgen",
    annuities: "/annuities",
    sonic: "/sonic",
    wordle: "/wordle",
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

    const { user } = useSelector(
        (state) => state.data
    );

    const FALLBACK_TITLE = "It's simple.";
    const [titleText, setTitleText] = useState(FALLBACK_TITLE);

    // Pull the dynamic homepage title from the backend; keep the hard-coded
    // fallback if the request fails for any reason (network error, backend
    // down, etc.) so the homepage never breaks.
    useEffect(() => {
        let cancelled = false;
        dataService.getHomeTitle()
            .then((res) => {
                if (!cancelled && res?.title) {
                    setTitleText(res.title);
                }
            })
            .catch(() => {
                // Keep FALLBACK_TITLE — no need to surface this to the user.
            });
        return () => { cancelled = true; };
    }, []);

    // Restart the typewriter effect whenever the resolved title changes
    // (e.g. the fetched title arrives after the fallback already finished typing).
    useEffect(() => {
        setDisplayedText("");
        setIsTyping(true);
    }, [titleText]);

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

    // Fetch user usage/membership when logged in
    useEffect(() => {
        if (user) {
            dispatch(getUserUsage());
        }
    }, [dispatch, user]);

    return (
        <>
            <SEO
                title="Home"
                description="Steven Tanner Hopwood — Portfolio showcasing web development projects, tools, and experiments."
                path="/"
                jsonLd={{
                    '@context': 'https://schema.org',
                    '@type': 'WebSite',
                    name: 'STHopwood',
                    url: SITE_URL,
                    author: {
                        '@type': 'Person',
                        name: 'Steven Tanner Hopwood',
                    },
                }}
            />
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
                            <h1 style={{ display: 'inline', font: 'inherit', margin: 0 }}>
                                {displayedText}
                            </h1>
                            <span className="cursor">|</span>
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
                            
                            {/* Tools & Games */}
                            <a className="home-spc-tool animate-in" href={links.iq} style={{animationDelay: '0.2s'}}>
                                <div className="home-spc-tool-text">{links.iq}</div>
                            </a>
                            <a className="home-spc-tool animate-in" href={links.annuities} style={{animationDelay: '0.25s'}}>
                                <div className="home-spc-tool-text">{links.annuities}</div>
                            </a>
                            {/* {user && 
                                <a className="home-spc-tool animate-in" href={links.plans} style={{animationDelay: '0.25s'}}>
                                    <div className="home-spc-tool-text">{links.plans}</div>
                                </a>
                            } */}
                            <a className="home-spc-tool animate-in" href={links.wordle} style={{animationDelay: '0.3s'}}>
                                <div className="home-spc-tool-text">{links.wordle}</div>
                            </a>
                            
                            {/* Utilities & Tools */}
                            {user && <>
                                {/* <a className="home-spc-tool animate-in" href={links.passgen} style={{animationDelay: '0.35s'}}>
                                    <div className="home-spc-tool-text">{links.passgen}</div>
                                </a> */}
                                <a className="home-spc-tool animate-in" href={links.net} style={{animationDelay: '0.35s'}}>
                                    <div className="home-spc-tool-text">{links.net}</div>
                                </a>
                            </>}
                            
                            {/* Account (Profile if logged in, else Login) */}
                            <a className="home-spc-tool animate-in" href={user ? links.profile : links.login} style={{animationDelay: '0.4s'}}>
                                <div className="home-spc-tool-text home-spc-tool-text--account">{user ? links.profile : links.login}</div>
                            </a>

                            {/* Admin (Special Access) */}
                            {(user && user._id && user._id.toString() === '6770a067c725cbceab958619') && 
                                <a className="home-spc-tool animate-in" href={links.admin} style={{animationDelay: '0.45s'}}>
                                    <div className="home-spc-tool-text">{links.admin}</div>
                                </a>}
                        </div>
                    </div>
                </section>

                <section className="section-tile thank-you-section">
                    <div id="content-tile">
                        <div id="text-body" className="thank-you-text">
                            <span className="heart-pulse">❤️</span>
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
