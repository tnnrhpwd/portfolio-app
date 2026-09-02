import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Footer from '../../../components/Footer/Footer';
import Header from '../../../components/Header/Header';
import SEO from '../../../components/SEO/SEO.jsx';
import useScrollReveal from '../../../hooks/useScrollReveal.js';
import './Projects.css';

import artHero from '../../../assets/art/hero.jpg';
import artFluid from '../../../assets/art/project-fluid.jpg';
import art2048 from '../../../assets/art/project-2048.jpg';
import artColosseum from '../../../assets/art/Hero banner.jpg';
import artSonic from '../../../assets/art/project-sonic.jpg';
import artWordle from '../../../assets/art/project-wordle.jpg';
import artPolls from '../../../assets/art/project-polls.jpg';
import artGames from '../../../assets/art/feature-games.jpg';
import artEngineering from '../../../assets/art/feature-engineering.jpg';
import artProductivity from '../../../assets/art/feature-productivity.jpg';
import artSurprises from '../../../assets/art/feature-surprises.jpg';
import artHype from '../../../assets/art/project-hype.jpg';

// ── Project catalog ────────────────────────────────────────────────────────
// Every project/tool that lives under the /projects umbrella. Keep the paths
// in sync with the routes declared in App.js. `art` points at the AI-generated
// artwork in frontend/src/assets/art/ (see docs/guides/FRONTEND_UI_STANDARD.md §5).
const PROJECTS = [
  {
    name: "Annuities",
    path: "/annuities",
    art: artEngineering,
    category: "Tools",
    description: "Calculate the effect of compound interest on your investment with an interactive annuities and engineering-economy calculator.",
  },
  {
    name: "Fluid",
    path: "/fluid",
    art: artFluid,
    category: "Tools",
    description: "Paint glowing, mouse-reactive fluid that swirls and flows in real time — a free incompressible fluid simulation.",
  },
  {
    name: "2048",
    path: "/2048",
    art: art2048,
    category: "Games",
    description: "Play a custom 2048 tile-merging game with swipe, drag, or keyboard controls, saved progress, and a public leaderboard.",
  },
  {
    name: "Colosseum",
    path: "/colosseum",
    art: artColosseum,
    category: "Games",
    description: "Recruit, train, and equip gladiators, then battle through the arena in this free turn-based strategy game.",
  },
  {
    name: "Halfway",
    path: "/halfway",
    art: artEngineering,
    category: "Tools",
    description: "Find the halfway meeting point in time between sunrise and sunset for two locations.",
  },
  {
    name: "IQ Test",
    path: "/iq",
    art: artGames,
    category: "Games",
    description: "Take a free adaptive IQ test with multiple difficulty tiers and instant results.",
  },
  {
    name: "PassGen",
    path: "/passgen",
    art: artEngineering,
    category: "Tools",
    description: "Generate secure, random passwords instantly with customizable length and character options.",
  },
  {
    name: "SleepAssist",
    path: "/sleepassist",
    art: artProductivity,
    category: "Tools",
    description: "Calculate optimal sleep and wake times based on natural sleep cycles.",
  },
  {
    name: "Sonic",
    path: "/sonic",
    art: artSonic,
    category: "Tools",
    description: "Analyze audio frequencies and musical notes in real time with a free browser-based pitch detector and tuner.",
  },
  {
    name: "Wordle",
    path: "/wordle",
    art: artWordle,
    category: "Games",
    description: "Play a customizable Wordle clone with adjustable word length and a built-in solver.",
  },
  {
    name: "Wordle Solver",
    path: "/wordlesolver",
    art: artGames,
    category: "Tools",
    description: "Solve any Wordle puzzle instantly with this interactive solver.",
  },
  {
    name: "Pets",
    path: "/pets",
    art: artSurprises,
    category: "Fun",
    description: "Adopt, feed, train, and care for virtual pets with daily challenges.",
  },
  {
    name: "Hype",
    path: "/hype",
    art: artHype,
    category: "Fun",
    description: "Get fired up with AI-generated hype quotes, a hype meter, confetti bursts, and a hidden hype-song Easter egg.",
  },
  {
    name: "Polls",
    path: "/polls",
    art: artPolls,
    category: "Tools",
    description: "Create and vote in quick polls. No sign-in required — make a poll and share the link.",
  },
];

const CATEGORIES = ["All", ...new Set(PROJECTS.map((project) => project.category))];

function Projects() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(
    () => CATEGORIES.find((c) => c === searchParams.get("category")) || "All"
  );

  // Keep the active filter in sync with the URL so deep links from the home
  // page (e.g. /projects?category=Fun) open with that filter applied.
  useEffect(() => {
    const cat = searchParams.get("category");
    if (cat && CATEGORIES.includes(cat)) {
      setCategory(cat);
    }
  }, [searchParams]);

  const handleCategory = (cat) => {
    setCategory(cat);
    const next = new URLSearchParams(searchParams);
    if (cat === "All") {
      next.delete("category");
    } else {
      next.set("category", cat);
    }
    setSearchParams(next, { replace: true });
  };

  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return PROJECTS.filter((project) => {
      const matchesCategory = category === "All" || project.category === category;
      const matchesQuery =
        !needle ||
        project.name.toLowerCase().includes(needle) ||
        project.description.toLowerCase().includes(needle) ||
        project.category.toLowerCase().includes(needle);
      return matchesCategory && matchesQuery;
    });
  }, [query, category]);

  // Scroll-triggered reveal for the project grid (see FRONTEND_UI_STANDARD.md §5).
  // The grid stacks into one tall column on mobile, so use a low threshold — the
  // default 0.15 can never be reached when a section is taller than the viewport.
  const [gridRef, gridVisible] = useScrollReveal({ threshold: 0.05, rootMargin: '0px' });

  return (
    <>
      <SEO
        title="Projects"
        description="Explore Steven Tanner Hopwood's collection of interactive tools, games, and experiments — calculators, puzzles, and utilities built with React and Node.js."
        path="/projects"
      />
      <Header />

      <div className="projects">
        {/* ── Hero ── */}
        <section className="projects-hero">
          <img className="projects-hero-media" src={artHero} alt="" aria-hidden="true" />
          <div className="projects-hero-floating" aria-hidden="true">
            <div className="projects-circle projects-circle-1" />
            <div className="projects-circle projects-circle-2" />
            <div className="projects-circle projects-circle-3" />
          </div>
          <div className="projects-hero-wrap">
            <p className="projects-eyebrow">
              <span className="projects-eyebrow-dot" aria-hidden="true" />
              Portfolio · The playground
            </p>
            <h1 className="projects-title">Projects</h1>
            <p className="projects-subtitle">
              A collection of tools, games, and experiments I've built. Pick a card to jump in.
            </p>

            <div className="projects-controls">
              <input
                className="projects-search"
                type="search"
                placeholder="Search projects…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search projects"
              />
              <div className="projects-filters" aria-label="Filter projects by category">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`projects-filter${category === cat ? " is-active" : ""}`}
                    aria-pressed={category === cat}
                    onClick={() => handleCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Project grid ── */}
        <section
          ref={gridRef}
          className={`projects-band projects-reveal ${gridVisible ? 'is-visible' : ''}`}
        >
          <div className="projects-wrap">
            <div className="projects-section-head">
              <p className="projects-eyebrow">Browse</p>
              <h2 className="projects-heading">All projects</h2>
              <p className="projects-lead">
                {category === 'All' && !query.trim()
                  ? `${PROJECTS.length} tools, games, and experiments to explore.`
                  : `Showing ${filteredProjects.length} ${filteredProjects.length === 1 ? 'project' : 'projects'}.`}
              </p>
            </div>

            {filteredProjects.length === 0 ? (
              <p className="projects-empty">
                No projects match your search — try another keyword or category.
              </p>
            ) : (
              <div className="projects-grid" role="list" aria-label="Project list">
                {filteredProjects.map((project) => (
                  <Link key={project.path} to={project.path} className="projects-card" role="listitem">
                    <img
                      className="projects-card-media"
                      src={project.art}
                      alt=""
                      loading="lazy"
                      aria-hidden="true"
                    />
                    <span className="projects-card-body">
                      <span className="projects-card-cat">{project.category}</span>
                      <span className="projects-card-title">
                        {project.name}
                        <span className="projects-card-arrow" aria-hidden="true">→</span>
                      </span>
                      <span className="projects-card-desc">{project.description}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── Meta links ── */}
        <section className="projects-band projects-band--meta">
          <div className="projects-wrap projects-meta">
            <a
              className="projects-meta-link"
              href="https://docs.google.com/document/d/1l8yCRlom5hw-SwOfZtpria_AUuXwcXpC/edit?usp=sharing&ouid=106668374323360993837&rtpof=true&sd=true"
              rel="noopener noreferrer"
              target="_blank"
            >
              STH Resume <span aria-hidden="true">↗</span>
            </a>
            <a
              className="projects-meta-link"
              href="https://github.com/tnnrhpwd/portfolio-app"
              rel="noopener noreferrer"
              target="_blank"
            >
              This Website's GitHub Repo <span aria-hidden="true">↗</span>
            </a>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}

export default Projects;