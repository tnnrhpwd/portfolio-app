import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Footer from '../../../components/Footer/Footer';
import Header from '../../../components/Header/Header';
import SEO from '../../../components/SEO/SEO.jsx';
import useScrollReveal from '../../../hooks/useScrollReveal.js';
import { fetchProjectRankings } from '../../../services/projectRankingsApi';
import './Projects.css';

import artHero from '../../../assets/art/hero.jpg';
import { PROJECTS } from "../../../constants/projects";

const CATEGORIES = ["All", ...new Set(PROJECTS.map((project) => project.category))];

function Projects() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(
    () => CATEGORIES.find((c) => c === searchParams.get("category")) || "All"
  );
  const [visitCounts, setVisitCounts] = useState({});

  // Keep the active filter in sync with the URL so deep links from the home
  // page (e.g. /projects?category=Fun) open with that filter applied.
  useEffect(() => {
    const cat = searchParams.get("category");
    if (cat && CATEGORIES.includes(cat)) {
      setCategory(cat);
    }
  }, [searchParams]);

  // Load per-project visit counts so the catalog can be ranked by traffic.
  // This is a progressive enhancement — if it fails, we fall back to the
  // static catalog order without disturbing the page.
  useEffect(() => {
    let cancelled = false;
    fetchProjectRankings(PROJECTS.map((project) => project.path))
      .then(({ pages = [] }) => {
        if (cancelled) return;
        const counts = {};
        pages.forEach((page) => {
          counts[page.path] = page.visits;
        });
        setVisitCounts(counts);
      })
      .catch(() => {
        // Ignore — keep the default ordering.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    const matches = PROJECTS.filter((project) => {
      const matchesCategory = category === "All" || project.category === category;
      const matchesQuery =
        !needle ||
        project.name.toLowerCase().includes(needle) ||
        project.description.toLowerCase().includes(needle) ||
        project.category.toLowerCase().includes(needle);
      return matchesCategory && matchesQuery;
    });

    // Rank by visits (highest first). Array.prototype.sort is stable, so
    // projects with equal visits keep their original catalog order.
    return matches.slice().sort((a, b) => (visitCounts[b.path] || 0) - (visitCounts[a.path] || 0));
  }, [query, category, visitCounts]);

  // Scroll-triggered reveal for the project grid (see FRONTEND_UI_STANDARD.md §5).
  // The grid stacks into one tall column on mobile, so it relies on the hook's
  // fast defaults (threshold 0 + a bottom rootMargin) to reveal as soon as it nears.
  const [gridRef, gridVisible] = useScrollReveal();

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
                      {visitCounts[project.path] > 0 && (
                        <span className="projects-card-visits" aria-label={`${visitCounts[project.path]} visits`}>
                          {visitCounts[project.path].toLocaleString()} visit{visitCounts[project.path] === 1 ? '' : 's'}
                        </span>
                      )}
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