import React, { useEffect, useState } from "react";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import { useSelector, useDispatch } from 'react-redux';
import { getPublicData, getUserUsage } from '../../features/data/dataSlice.js';
import { normalizePlanName, isProTier, isSimpleTier, FEATURES, PLAN_IDS, CREDITS } from '../../constants/pricing.js';
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

    const { user, userUsage } = useSelector(
        (state) => state.data
    );

    // Derive membership info
    const rawRank = userUsage?.membership || 'Free';
    const membership = normalizePlanName(rawRank);
    const isFree = !isProTier(rawRank) && !isSimpleTier(rawRank);
    const isPro = isProTier(rawRank);
    const isSimple = isSimpleTier(rawRank);

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

    // Fetch user usage/membership when logged in
    useEffect(() => {
        if (user) {
            dispatch(getUserUsage());
        }
    }, [dispatch, user]);

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
                                <a className="home-spc-tool animate-in" href={links.passgen} style={{animationDelay: '0.25s'}}>
                                    <div className="home-spc-tool-text">{links.passgen}</div>
                                </a>
                                <a className="home-spc-tool animate-in" href={links.net} style={{animationDelay: '0.3s'}}>
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

                        </div>
                    </div>

                </section>

                {/* Membership & AI Chat Section */}
                <section className="section-tile membership-section">
                    <div id="content-tile">
                        {/* Current Plan Badge — logged-in users only */}
                        {user && (
                            <div className={`membership-badge membership-${membership.toLowerCase()}`}>
                                <span className="badge-icon">
                                    {isSimple ? '⭐' : isPro ? '🔷' : '🔓'}
                                </span>
                                <span className="badge-label">{membership} Plan</span>
                            </div>
                        )}

                        {/* AI Chat Card — visible to all users */}
                        <div className="home-feature-card ai-chat-card">
                            <div className="feature-card-icon">🤖</div>
                            <div className="feature-card-body">
                                <h3 className="feature-card-title">AI Chat</h3>
                                <p className="feature-card-desc">
                                    {!user
                                        ? 'Chat with leading AI models. Create a free account to bring your own API key, or subscribe for included credits.'
                                        : isFree
                                            ? `Bring your own API key to use AI chat, or upgrade to Pro for ${CREDITS[PLAN_IDS.PRO].display}/mo in included credits.`
                                            : isPro
                                                ? <>You have {CREDITS[PLAN_IDS.PRO].display}/mo in AI credits.
                                                    {userUsage?.availableCredits != null && (
                                                        <> <strong>${Number(userUsage.availableCredits).toFixed(2)}</strong> remaining this cycle.</>
                                                    )}</>
                                                : <>You have {CREDITS[PLAN_IDS.SIMPLE].display}/mo in AI credits with priority support.
                                                    {userUsage?.availableCredits != null && (
                                                        <> <strong>${Number(userUsage.availableCredits).toFixed(2)}</strong> remaining this cycle.</>
                                                    )}</>
                                    }
                                </p>
                                {user
                                    ? <a href="/net" className="feature-card-link">Open AI Chat</a>
                                    : <a href="/login" className="feature-card-link">Log in to use AI Chat</a>
                                }
                            </div>
                        </div>

                        {/* Upgrade Prompt — logged-in Free and Pro users */}
                        {user && !isSimple && (
                            <div className={`home-upgrade-card upgrade-from-${membership.toLowerCase()}`}>
                                <div className="upgrade-card-header">
                                    <span className="upgrade-icon">{isFree ? '🚀' : '⬆️'}</span>
                                    <h3 className="upgrade-title">
                                        {isFree
                                            ? 'Unlock AI Credits'
                                            : 'Go Simple — Full Power'}
                                    </h3>
                                </div>
                                <p className="upgrade-desc">
                                    {isFree
                                        ? 'Upgrade to Pro for 500 commands/day and $0.50/mo in AI credits, or go Simple for the full experience.'
                                        : 'Get 5,000 commands/day, $10/mo AI credits, phone-to-PC remote control, 50 GB storage, and priority support.'}
                                </p>
                                <div className="upgrade-features">
                                    {(isFree ? FEATURES[PLAN_IDS.PRO] : FEATURES[PLAN_IDS.SIMPLE]).slice(0, 3).map((f, i) => (
                                        <span key={i} className="upgrade-feature-pill">{f}</span>
                                    ))}
                                </div>
                                <a href="/pay" className="upgrade-cta">
                                    {isFree ? 'View Plans' : 'Upgrade to Simple'}
                                </a>
                            </div>
                        )}

                        {/* Sign-up CTA — non-logged-in users only */}
                        {!user && (
                            <div className="home-upgrade-card upgrade-from-guest">
                                <div className="upgrade-card-header">
                                    <span className="upgrade-icon">🚀</span>
                                    <h3 className="upgrade-title">Get Started Free</h3>
                                </div>
                                <p className="upgrade-desc">
                                    Sign up for free to unlock AI chat, password tools, annuity calculators, and more. Upgrade anytime for bonus credits and premium features.
                                </p>
                                <div className="upgrade-features">
                                    {FEATURES[PLAN_IDS.FREE].slice(0, 3).map((f, i) => (
                                        <span key={i} className="upgrade-feature-pill">{f}</span>
                                    ))}
                                </div>
                                <div className="upgrade-cta-row">
                                    <a href="/login" className="upgrade-cta">
                                        Create Free Account
                                    </a>
                                    <a href="/login" className="upgrade-cta-secondary">
                                        Log In
                                    </a>
                                </div>
                            </div>
                        )}
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
            </div>
        </>
    );
}

export default Home;
