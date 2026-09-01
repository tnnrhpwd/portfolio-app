import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Footer from '../../../components/Footer/Footer';
import Header from '../../../components/Header/Header';
import "./Projects.css";

// ── Project catalog ────────────────────────────────────────────────────────
// Every project/tool that lives under the /projects umbrella. Keep the paths
// in sync with the routes declared in App.js.
const PROJECTS = [
  {
    name: "Annuities",
    path: "/annuities",
    emoji: "💰",
    category: "Finance",
    description: "Calculate the effect of compound interest on your investment with an interactive annuities and engineering-economy calculator.",
  },
  {
    name: "Ethanol",
    path: "/ethanol",
    emoji: "🍹",
    category: "Health",
    description: "Calculate standard alcoholic drink equivalents from volume and percent alcohol, and track your drinks with a built-in log.",
  },
  {
    name: "Fluid",
    path: "/fluid",
    emoji: "🌊",
    category: "Interactive",
    description: "Paint glowing, mouse-reactive fluid that swirls and flows in real time — a free incompressible fluid simulation.",
  },
  {
    name: "2048",
    path: "/2048",
    emoji: "🎮",
    category: "Games",
    description: "Play a custom 2048 tile-merging game with swipe, drag, or keyboard controls, saved progress, and a public leaderboard.",
  },
  {
    name: "Halfway",
    path: "/halfway",
    emoji: "🌅",
    category: "Tools",
    description: "Find the halfway meeting point in time between sunrise and sunset for two locations.",
  },
  {
    name: "IQ Test",
    path: "/iq",
    emoji: "🧠",
    category: "Games",
    description: "Take a free adaptive IQ test with multiple difficulty tiers and instant results.",
  },
  {
    name: "PassGen",
    path: "/passgen",
    emoji: "🔑",
    category: "Utilities",
    description: "Generate secure, random passwords instantly with customizable length and character options.",
  },
  {
    name: "SleepAssist",
    path: "/sleepassist",
    emoji: "😴",
    category: "Health",
    description: "Calculate optimal sleep and wake times based on natural sleep cycles.",
  },
  {
    name: "Sonic",
    path: "/sonic",
    emoji: "🎵",
    category: "Audio",
    description: "Analyze audio frequencies and musical notes in real time with a free browser-based pitch detector and tuner.",
  },
  {
    name: "Wordle",
    path: "/wordle",
    emoji: "🟩",
    category: "Games",
    description: "Play a customizable Wordle clone with adjustable word length and a built-in solver.",
  },
  {
    name: "Wordle Solver",
    path: "/wordlesolver",
    emoji: "🔍",
    category: "Tools",
    description: "Solve any Wordle puzzle instantly with this interactive solver.",
  },
  {
    name: "Pets",
    path: "/pets",
    emoji: "🐾",
    category: "Fun",
    description: "Adopt, feed, train, and care for virtual pets with daily challenges.",
  },
  {
    name: "Polls",
    path: "/polls",
    emoji: "📊",
    category: "Tools",
    description: "Create and vote in quick polls. No sign-in required — make a poll and share the link.",
  },
];

const CATEGORIES = ["All", ...new Set(PROJECTS.map((project) => project.category))];

function Projects() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

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

  return (
    <>
      <Header />
      <main className="projects-page">
        <section className="projects-hero">
          <h1 className="projects-title">Projects</h1>
          <p className="projects-subtitle">
            A collection of tools, games, and experiments I've built. Click a card to explore.
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
                  onClick={() => setCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </section>

        {filteredProjects.length === 0 ? (
          <p className="projects-empty">No projects match your search.</p>
        ) : (
          <section className="projects-grid" aria-label="Project list">
            {filteredProjects.map((project, index) => (
              <Link
                key={project.path}
                to={project.path}
                className="project-card"
                style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
              >
                <span className="project-card-icon" aria-hidden="true">
                  {project.emoji}
                </span>
                <span className="project-card-body">
                  <span className="project-card-title">{project.name}</span>
                  <span className="project-card-description">{project.description}</span>
                </span>
                <span className="project-card-footer">
                  <span className="project-card-tag">{project.category}</span>
                  <span className="project-card-visit">Visit →</span>
                </span>
              </Link>
            ))}
          </section>
        )}

        <section className="projects-meta">
          <a
            className="projects-meta-link"
            href="https://docs.google.com/document/d/1l8yCRlom5hw-SwOfZtpria_AUuXwcXpC/edit?usp=sharing&ouid=106668374323360993837&rtpof=true&sd=true"
            rel="noopener noreferrer"
            target="_blank"
          >
            STH Resume
          </a>
          <a
            className="projects-meta-link"
            href="https://github.com/tnnrhpwd/portfolio-app"
            rel="noopener noreferrer"
            target="_blank"
          >
            This Website's GitHub Repo
          </a>
        </section>
      </main>
      <Footer />
    </>
  );
}

export default Projects;