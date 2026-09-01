import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import SEO, { SITE_URL } from "../../components/SEO/SEO.jsx";
import { useSelector, useDispatch } from 'react-redux';
import { getUserUsage } from '../../features/data/dataSlice.js';
import dataService from '../../features/data/dataService.js';
import useScrollReveal from '../../hooks/useScrollReveal.js';
import './Home.css';

// Same hardcoded admin id used to gate the /admin page — the girlfriend's
// account nickname (case-insensitive) also unlocks the /muse link.
const ADMIN_USER_ID = '6770a067c725cbceab958619';
const GIRLFRIEND_NICKNAME = 'girlfriend';
const FALLBACK_TITLE = "It's simple.";

// Curated projects surfaced on the homepage (paths match the routes in App.js).
const FEATURED_PROJECTS = [
  { name: "Fluid", path: "/fluid", emoji: "🌊", category: "Interactive", description: "Paint glowing, mouse-reactive fluid that swirls in real time." },
  { name: "2048", path: "/2048", emoji: "🎮", category: "Games", description: "A tile-merging game with swipe, drag, or keyboard controls." },
  { name: "Sonic", path: "/sonic", emoji: "🎵", category: "Audio", description: "A real-time pitch detector and musical note tuner." },
  { name: "Wordle", path: "/wordle", emoji: "🟩", category: "Games", description: "A customizable Wordle clone with adjustable word length." },
  { name: "Ethanol", path: "/ethanol", emoji: "🍹", category: "Health", description: "Standard drink equivalents plus a built-in drink log." },
  { name: "Polls", path: "/polls", emoji: "📊", category: "Tools", description: "Create and share quick polls — no sign-in required." },
];

const STATS = [
  { value: "13+", label: "Tools & games" },
  { value: "100%", label: "Free to use" },
  { value: "0", label: "Sign-ups needed" },
  { value: "OSS", label: "Open source" },
];

// The site's offerings, shown as a feature grid (Squarespace-style).
const WHATS_INSIDE = [
  { emoji: "🎮", title: "Games & puzzles", desc: "2048, Wordle, IQ Test, and more to pass the time." },
  { emoji: "🧮", title: "Engineering tools", desc: "Annuities, ethanol, and fluid calculators built for engineers." },
  { emoji: "🎯", title: "Productivity", desc: "Polls, goals, and plans to organize your day." },
  { emoji: "🐾", title: "Little surprises", desc: "Virtual pets, Hype, and other fun experiments." },
];

// Numbered "getting started" steps.
const STEPS = [
  { num: "01", title: "Browse the playground", desc: "Pick a tool or game that catches your eye." },
  { num: "02", title: "Jump right in", desc: "Most things work instantly — no account needed." },
  { num: "03", title: "Create an account", desc: "Save progress, track goals, and unlock member tools." },
  { num: "04", title: "Say hello", desc: "Questions, ideas, or bugs? Drop a line anytime." },
];

function Home() {
    const dispatch = useDispatch();
    const [displayedText, setDisplayedText] = useState("");
    const [isTyping, setIsTyping] = useState(true);
    const [animationPhase, setAnimationPhase] = useState(0);

    const { user } = useSelector(
        (state) => state.data
    );

    // Scroll-triggered reveals (see FRONTEND_UI_STANDARD.md §5) — one per major section.
    const [statsRef, statsVisible] = useScrollReveal();
    const [templatesRef, templatesVisible] = useScrollReveal();
    const [featuresRef, featuresVisible] = useScrollReveal();
    const [howtoRef, howtoVisible] = useScrollReveal();
    const [linksRef, linksVisible] = useScrollReveal();
    const [ctaRef, ctaVisible] = useScrollReveal();

    const isMuseVisitor = !!user && (
        (user._id && user._id.toString() === ADMIN_USER_ID)
        || String(user.nickname || '').trim().toLowerCase() === GIRLFRIEND_NICKNAME
    );
    const isAdmin = !!user && user._id && user._id.toString() === ADMIN_USER_ID;

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

    // Friendly "around the site" links, gated by account type.
    const siteLinks = [
        { label: user ? "Profile" : "Login", path: user ? "/profile" : "/login", emoji: user ? "👤" : "🔐" },
        { label: "About", path: "/about", emoji: "🙋" },
        { label: "Projects", path: "/projects", emoji: "🧰" },
        { label: "Contact", path: "/contact", emoji: "✉️" },
        { label: "Support", path: "/support", emoji: "💬" },
        { label: "Pricing", path: "/pricing", emoji: "💳" },
    ];
    if (user) {
        siteLinks.push({ label: "My Net", path: "/net", emoji: "🕸️" });
        siteLinks.push({ label: "Plans", path: "/plans", emoji: "🎯" });
    }
    if (isAdmin) {
        siteLinks.push({ label: "Admin", path: "/admin", emoji: "🛠️" });
    }
    if (isMuseVisitor) {
        siteLinks.push({ label: "Muse", path: "/muse", emoji: "💕" });
    }

    return (
        <>
            <SEO
                title="Steven Tanner Hopwood"
                description="Steven Tanner Hopwood (STHopwood) — Advanced Manufacturing Engineer and full-stack developer. Portfolio showcasing web development projects, tools, and experiments."
                path="/"
                jsonLd={{
                    '@context': 'https://schema.org',
                    '@type': 'WebSite',
                    name: 'STHopwood',
                    alternateName: ['Steven Tanner Hopwood Portfolio', 'sthopwood.com'],
                    url: SITE_URL,
                    author: {
                        '@type': 'Person',
                        name: 'Steven Tanner Hopwood',
                        alternateName: ['Steven Hopwood', 'STHopwood', 'sthopwood'],
                        sameAs: [
                            'https://www.linkedin.com/in/sthopwood/',
                            'https://github.com/tnnrhpwd',
                        ],
                    },
                }}
            />
            <Header />

            <div className="home">
                {/* Decorative, non-interactive background circles */}
                <div className="home-floating" aria-hidden="true">
                    <div className="home-circle home-circle-1" />
                    <div className="home-circle home-circle-2" />
                    <div className="home-circle home-circle-3" />
                </div>

                {/* ── Promo bar ── */}
                <div className="home-promo">
                    <span aria-hidden="true">✨</span>
                    Free forever · No sign-in required · Open source
                    <Link to="/pricing" className="home-promo-link">See plans →</Link>
                </div>

                {/* ── Hero ── */}
                <section className="home-section home-hero">
                    <div className="home-hero-wrap">
                        <p className="home-eyebrow">
                            <span className="home-eyebrow-dot" aria-hidden="true" />
                            Portfolio · Full-stack developer
                        </p>
                        {/*
                          Visually-hidden but crawlable H1: the visible typewriter
                          text below is decorative/dynamic (fetched from the
                          backend) and shouldn't be the page's only H1.
                        */}
                        <h1 className="sr-only">Steven Tanner Hopwood — STHopwood Portfolio</h1>
                        <div className="home-title">
                            <span>{displayedText}</span>
                            <span className="home-cursor" aria-hidden="true">|</span>
                        </div>
                        <p className={`home-subtitle ${animationPhase >= 1 ? 'is-visible' : ''}`}>
                            Let's build a brighter tomorrow!
                        </p>
                        <p className={`home-kicker ${animationPhase >= 1 ? 'is-visible' : ''}`}>
                            Manufacturing, Engineering, and Process Development
                        </p>
                        <div className={`home-actions ${animationPhase >= 1 ? 'is-visible' : ''}`}>
                            <Link className="home-btn" to="/projects">Explore projects</Link>
                            <Link className="home-btn home-btn-outline" to="/about">Learn more about us</Link>
                        </div>
                    </div>
                </section>

                {/* ── Highlights ── */}
                <section ref={statsRef} className={`home-section home-stats home-reveal ${statsVisible ? 'is-visible' : ''}`} aria-label="Highlights">
                    {STATS.map((stat) => (
                        <div className="home-stat" key={stat.label}>
                            <span className="home-stat-value">{stat.value}</span>
                            <span className="home-stat-label">{stat.label}</span>
                        </div>
                    ))}
                </section>

                {/* ── Templates row ── */}
                <section ref={templatesRef} className={`home-section home-templates home-reveal ${templatesVisible ? 'is-visible' : ''}`}>
                    <div className="home-section-head">
                        <p className="home-eyebrow">The playground</p>
                        <h2 className="home-heading">Start with a tool you'll love</h2>
                        <p className="home-lead">Pick a project, open it, and start playing — no downloads, no accounts.</p>
                    </div>
                    <div className="home-templates-row" role="list">
                        {FEATURED_PROJECTS.map((project) => (
                            <Link key={project.path} to={project.path} className="home-template-card" role="listitem">
                                <span className="home-template-preview" aria-hidden="true">{project.emoji}</span>
                                <span className="home-template-name">
                                    {project.name}
                                    <span className="home-template-arrow" aria-hidden="true">→</span>
                                </span>
                                <span className="home-template-cat">{project.category}</span>
                            </Link>
                        ))}
                    </div>
                    <div className="home-more">
                        <Link className="home-btn home-btn-outline" to="/projects">View all projects</Link>
                    </div>
                </section>

                {/* ── What's inside ── */}
                <section ref={featuresRef} className={`home-section home-features home-reveal ${featuresVisible ? 'is-visible' : ''}`}>
                    <div className="home-section-head">
                        <p className="home-eyebrow">Explore</p>
                        <h2 className="home-heading">Something for everyone</h2>
                        <p className="home-lead">A growing collection of tools, games, and experiments.</p>
                    </div>
                    <div className="home-grid">
                        {WHATS_INSIDE.map((item) => (
                            <div className="home-feature" key={item.title}>
                                <span className="home-feature-icon" aria-hidden="true">{item.emoji}</span>
                                <h3 className="home-feature-title">{item.title}</h3>
                                <p className="home-feature-desc">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                    <div className="home-more">
                        <Link className="home-btn" to="/projects">Explore projects</Link>
                    </div>
                </section>

                {/* ── How to get started ── */}
                <section ref={howtoRef} className={`home-section home-howto home-reveal ${howtoVisible ? 'is-visible' : ''}`}>
                    <div className="home-section-head">
                        <p className="home-eyebrow">Getting started</p>
                        <h2 className="home-heading">How to get around</h2>
                    </div>
                    <ol className="home-steps">
                        {STEPS.map((step) => (
                            <li className="home-step" key={step.num}>
                                <span className="home-step-num" aria-hidden="true">{step.num}</span>
                                <div className="home-step-body">
                                    <h3 className="home-step-title">{step.title}</h3>
                                    <p className="home-step-desc">{step.desc}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                </section>

                {/* ── Around the site ── */}
                <section ref={linksRef} className={`home-section home-links home-reveal ${linksVisible ? 'is-visible' : ''}`}>
                    <div className="home-section-head">
                        <p className="home-eyebrow">Navigate</p>
                        <h2 className="home-heading">Around the site</h2>
                    </div>
                    <div className="home-links-grid">
                        {siteLinks.map((link) => (
                            <Link key={link.path} to={link.path} className="home-link-tile">
                                <span className="home-link-emoji" aria-hidden="true">{link.emoji}</span>
                                <span className="home-link-label">{link.label}</span>
                            </Link>
                        ))}
                    </div>
                </section>

                {/* ── Final CTA ── */}
                <section ref={ctaRef} className={`home-section home-cta home-reveal ${ctaVisible ? 'is-visible' : ''}`}>
                    <div className="home-cta-card">
                        <p className="home-eyebrow">No credit card required</p>
                        <h2 className="home-cta-title">Ready to explore?</h2>
                        <p className="home-cta-sub">Jump in and start building something fun — it's all free.</p>
                        <div className="home-actions">
                            <Link className="home-btn" to="/projects">Start exploring</Link>
                            <Link className="home-btn home-btn-outline" to="/contact">Get in touch</Link>
                        </div>
                    </div>
                </section>

                {/* ── Thank you ── */}
                <section className="home-section home-thanks">
                    <p className="home-thanks-text">
                        <span className="home-heart" aria-hidden="true">❤️</span>
                        Thank you for visiting.
                        <span className="home-heart" aria-hidden="true">❤️</span>
                    </p>
                    <p className="home-thanks-sub">
                        — Steven Tanner Hopwood · Advanced Manufacturing Engineer & developer
                    </p>
                </section>

                <Footer />
            </div>
        </>
    );
}

export default Home;
