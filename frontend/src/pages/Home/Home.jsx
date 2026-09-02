import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import SEO, { SITE_URL } from "../../components/SEO/SEO.jsx";
import { useSelector, useDispatch } from 'react-redux';
import { getUserUsage } from '../../features/data/dataSlice.js';
import dataService from '../../features/data/dataService.js';
import useScrollReveal from '../../hooks/useScrollReveal.js';
import { PROJECTS } from '../../constants/projects';
import { fetchProjectRankings } from '../../services/projectRankingsApi';

import artHero from '../../assets/art/hero.jpg';
import artFluid from '../../assets/art/project-fluid.jpg';
import art2048 from '../../assets/art/project-2048.jpg';
import artSonic from '../../assets/art/project-sonic.jpg';
import artWordle from '../../assets/art/project-wordle.jpg';
import artPolls from '../../assets/art/project-polls.jpg';
import artGames from '../../assets/art/feature-games.jpg';
import artEngineering from '../../assets/art/feature-engineering.jpg';
import artSurprises from '../../assets/art/feature-surprises.jpg';
import artNet from '../../assets/art/project-net.jpg';
import './Home.css';

// Same hardcoded admin id used to gate the /admin page — the girlfriend's
// account nickname (case-insensitive) also unlocks the /muse link.
const ADMIN_USER_ID = '6770a067c725cbceab958619';
const GIRLFRIEND_NICKNAME = 'girlfriend';
const FALLBACK_TITLE = "It's simple.";

// Curated projects surfaced on the homepage (paths match the routes in App.js).
const FEATURED_PROJECTS = [
  { name: "Fluid", path: "/fluid", art: artFluid, category: "Interactive", description: "Paint glowing, mouse-reactive fluid that swirls in real time." },
  { name: "2048", path: "/2048", art: art2048, category: "Games", description: "A tile-merging game with swipe, drag, or keyboard controls." },
  { name: "Sonic", path: "/sonic", art: artSonic, category: "Audio", description: "A real-time pitch detector and musical note tuner." },
  { name: "Wordle", path: "/wordle", art: artWordle, category: "Games", description: "A customizable Wordle clone with adjustable word length." },
  { name: "Polls", path: "/polls", art: artPolls, category: "Tools", description: "Create and share quick polls — no sign-in required." },
];

// The site's offerings, shown as a feature grid (Squarespace-style).
const WHATS_INSIDE = [
  { art: artGames, title: "Games & puzzles", desc: "2048, Wordle, IQ Test, and more to pass the time.", path: "/projects?category=Games" },
  { art: artEngineering, title: "Engineering tools", desc: "Annuities, fluid, and other calculators built for engineers.", path: "/projects" },
  { art: artNet, title: "Net AI Chat", desc: "Your AI-powered assistant for automation, coding, and more.", path: "/net" },
  { art: artSurprises, title: "Little surprises", desc: "Virtual pets, Hype, and other fun experiments.", path: "/projects?category=Fun" },
];

// Numbered "getting started" steps.
const STEPS = [
  { num: "01", title: "Browse the playground", desc: "Pick a tool or game that catches your eye.", path: "/projects" },
  { num: "02", title: "Jump right in", desc: "Most things work instantly — no account needed.", path: "/projects" },
  { num: "03", title: "Create an account", desc: "Save progress, track goals, and unlock member tools.", path: "/register" },
  { num: "04", title: "Say hello", desc: "Questions, ideas, or bugs? Drop a line anytime.", path: "/support?tab=contact" },
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
    const [templatesRef, templatesVisible] = useScrollReveal();
    const [featuresRef, featuresVisible] = useScrollReveal();
    const [howtoRef, howtoVisible] = useScrollReveal();
    const [linksRef, linksVisible] = useScrollReveal();
    const [ctaRef, ctaVisible] = useScrollReveal();

    // Horizontal carousel pagination (Squarespace-style dots + arrows).
    const templatesRowRef = useRef(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [topProjects, setTopProjects] = useState([]);

    const scrollToCard = (index) => {
        const row = templatesRowRef.current;
        if (!row) return;
        const card = row.children[index];
        if (!card) return;
        const maxScroll = row.scrollWidth - row.clientWidth;
        const rowLeft = row.getBoundingClientRect().left;
        const target = row.scrollLeft + (card.getBoundingClientRect().left - rowLeft);
        row.scrollTo({ left: Math.max(0, Math.min(target, maxScroll)), behavior: 'smooth' });
    };

    const handleTemplatesScroll = () => {
        const row = templatesRowRef.current;
        if (!row || !row.children.length) return;
        const last = row.children.length - 1;
        const maxScroll = row.scrollWidth - row.clientWidth;
        // The last card can't align to the left edge, so at the far right snap
        // the indicator to the last dot instead of rounding down short of it.
        if (row.scrollLeft >= maxScroll - 1) {
            setActiveIndex(last);
            return;
        }
        const card = row.children[0];
        const gap = parseFloat(getComputedStyle(row).columnGap || getComputedStyle(row).gap || '0');
        const step = card.getBoundingClientRect().width + (Number.isFinite(gap) ? gap : 0);
        if (!step) return;
        const index = Math.round(row.scrollLeft / step);
        setActiveIndex(Math.max(0, Math.min(index, last)));
    };

    useEffect(() => {
        const row = templatesRowRef.current;
        if (!row) return undefined;
        handleTemplatesScroll();
        row.addEventListener('scroll', handleTemplatesScroll, { passive: true });
        window.addEventListener('resize', handleTemplatesScroll);
        return () => {
            row.removeEventListener('scroll', handleTemplatesScroll);
            window.removeEventListener('resize', handleTemplatesScroll);
        };
    }, []);

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

    // Load per-project visit counts and surface the top 5 most-visited
    // projects in the "Start with a tool you'll love" carousel. Falls back to
    // the curated FEATURED_PROJECTS list when there's no traffic data yet.
    useEffect(() => {
        let cancelled = false;
        fetchProjectRankings(PROJECTS.map((project) => project.path))
            .then(({ pages = [] }) => {
                if (cancelled) return;
                const counts = {};
                pages.forEach((page) => {
                    counts[page.path] = page.visits;
                });
                const hasAnyVisits = pages.some((page) => page.visits > 0);
                if (!hasAnyVisits) {
                    setTopProjects([]);
                    return;
                }
                const ranked = PROJECTS
                    .slice()
                    .sort((a, b) => (counts[b.path] || 0) - (counts[a.path] || 0));
                setTopProjects(ranked.slice(0, 5));
            })
            .catch(() => {
                // Ignore — keep the curated fallback.
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
        { label: user ? "Profile" : "Login", path: user ? "/profile" : "/login" },
        { label: "About", path: "/about" },
        { label: "Projects", path: "/projects" },
        { label: "Contact", path: "/support?tab=contact" },
        { label: "Support", path: "/support" },
        { label: "Pricing", path: "/pricing" },
    ];
    if (user) {
        siteLinks.push({ label: "My Net", path: "/net" });
        siteLinks.push({ label: "Plans", path: "/plans" });
    }
    if (isAdmin) {
        siteLinks.push({ label: "Admin", path: "/admin" });
    }
    if (isMuseVisitor) {
        siteLinks.push({ label: "Muse", path: "/muse" });
    }

    // Show the top 5 most-visited projects once traffic data exists; otherwise
    // fall back to the hand-curated list.
    const featuredProjects = topProjects.length > 0 ? topProjects : FEATURED_PROJECTS;

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
                {/* ── Hero ── */}
                <section className="home-hero">
                    <img className="home-hero-media" src={artHero} alt="" aria-hidden="true" />
                    <div className="home-hero-floating" aria-hidden="true">
                        <div className="home-hero-circle home-hero-circle-1" />
                        <div className="home-hero-circle home-hero-circle-2" />
                        <div className="home-hero-circle home-hero-circle-3" />
                    </div>
                    <div className="home-hero-wrap">
                        {/* Visually-hidden but crawlable H1: the typewriter below is decorative. */}
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
                            <Link className="home-btn" to="/projects">Explore projects <span aria-hidden="true">→</span></Link>
                            <Link className="home-btn home-btn-text" to="/about">Learn more about us <span aria-hidden="true">→</span></Link>
                        </div>
                    </div>
                </section>

                {/* ── Featured projects (horizontal carousel) ── */}
                <section ref={templatesRef} className={`home-band home-band--surface home-projects home-reveal ${templatesVisible ? 'is-visible' : ''}`}>
                    <div className="home-wrap">
                        <div className="home-section-head">
                            <p className="home-eyebrow">The playground</p>
                            <h2 className="home-heading">Start with a tool you'll love</h2>
                            <p className="home-lead">Pick a project, open it, and start playing — no downloads, no accounts.</p>
                        </div>
                        <div className="home-templates-row" ref={templatesRowRef} role="list" aria-label="Featured projects">
                            {featuredProjects.map((project) => (
                                <Link key={project.path} to={project.path} className="home-template-card" role="listitem">
                                    <img className="home-template-media" src={project.art} alt="" loading="lazy" aria-hidden="true" />
                                    <span className="home-template-body">
                                        <span className="home-template-cat">{project.category}</span>
                                        <span className="home-template-name">
                                            {project.name}
                                            <span className="home-template-arrow" aria-hidden="true">→</span>
                                        </span>
                                        <span className="home-template-desc">{project.description}</span>
                                    </span>
                                </Link>
                            ))}
                        </div>
                        <div className="home-carousel-nav">
                            <button type="button" className="home-carousel-arrow" onClick={() => scrollToCard(Math.max(0, activeIndex - 1))} aria-label="Previous project">←</button>
                            <div className="home-dots" role="tablist" aria-label="Featured project pages">
                                {featuredProjects.map((project, i) => (
                                    <button
                                        key={project.path}
                                        type="button"
                                        role="tab"
                                        aria-selected={i === activeIndex}
                                        aria-label={`Go to ${project.name}`}
                                        className={`home-dot ${i === activeIndex ? 'is-active' : ''}`}
                                        onClick={() => scrollToCard(i)}
                                    />
                                ))}
                            </div>
                            <button type="button" className="home-carousel-arrow" onClick={() => scrollToCard(Math.min(featuredProjects.length - 1, activeIndex + 1))} aria-label="Next project">→</button>
                        </div>
                    </div>
                </section>

                {/* ── What's inside (alternating media rows) ── */}
                <section ref={featuresRef} className={`home-band home-band--surface home-features home-reveal ${featuresVisible ? 'is-visible' : ''}`}>
                    <div className="home-wrap">
                        <div className="home-section-head">
                            <p className="home-eyebrow">Explore</p>
                            <h2 className="home-heading">Something for everyone</h2>
                            <p className="home-lead">A growing collection of tools, games, and experiments.</p>
                        </div>
                        <div className="home-feature-list">
                            {WHATS_INSIDE.map((item, i) => (
                                <Link className={`home-feature-row ${i % 2 === 1 ? 'is-flipped' : ''}`} to={item.path} key={item.title}>
                                    <img className="home-feature-media" src={item.art} alt="" loading="lazy" aria-hidden="true" />
                                    <div className="home-feature-copy">
                                        <h3 className="home-feature-title">{item.title}</h3>
                                        <p className="home-feature-desc">{item.desc}</p>
                                        <span className="home-feature-link">Explore <span aria-hidden="true">→</span></span>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ── How to get started ── */}
                <section ref={howtoRef} className={`home-band home-band--tint home-howto home-reveal ${howtoVisible ? 'is-visible' : ''}`}>
                    <div className="home-wrap">
                        <div className="home-section-head">
                            <p className="home-eyebrow">Getting started</p>
                            <h2 className="home-heading">How to get around</h2>
                        </div>
                        <ol className="home-steps">
                            {STEPS.map((step) => (
                                <li className="home-step" key={step.num}>
                                    <span className="home-step-num" aria-hidden="true">{step.num}</span>
                                    <div className="home-step-body">
                                        <h3 className="home-step-title">
                                            <Link to={step.path}>{step.title} <span aria-hidden="true">→</span></Link>
                                        </h3>
                                        <p className="home-step-desc">{step.desc}</p>
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </div>
                </section>

                {/* ── Final CTA ── */}
                <section ref={ctaRef} className={`home-band home-cta home-reveal ${ctaVisible ? 'is-visible' : ''}`}>
                    <div className="home-wrap home-cta-inner">
                        <p className="home-eyebrow home-eyebrow--inv">No credit card required</p>
                        <h2 className="home-cta-title">Ready to explore?</h2>
                        <p className="home-cta-sub">Jump in and start building something fun.</p>
                        <div className="home-actions">
                            <Link className="home-btn home-btn--inv" to="/projects">Start exploring <span aria-hidden="true">→</span></Link>
                            <Link className="home-btn home-btn--ghost" to="/support?tab=contact">Get in touch</Link>
                        </div>
                    </div>
                </section>

                {/* ── Around the site ── */}
                <section ref={linksRef} className={`home-band home-band--surface home-links home-reveal ${linksVisible ? 'is-visible' : ''}`}>
                    <div className="home-wrap">
                        <div className="home-section-head">
                            <p className="home-eyebrow">Navigate</p>
                            <h2 className="home-heading">Around the site</h2>
                        </div>
                        <div className="home-links-grid">
                            {siteLinks.map((link) => (
                                <Link key={link.path} to={link.path} className="home-link-tile">
                                    <span className="home-link-label">{link.label}</span>
                                    <span className="home-link-arrow" aria-hidden="true">→</span>
                                </Link>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ── Thank you ── */}
                <section className="home-band home-thanks">
                    <div className="home-wrap">
                        <p className="home-thanks-text">Thank you for visiting❤️</p>
                    </div>
                </section>

                <Footer />
            </div>
        </>
    );
}

export default Home;
