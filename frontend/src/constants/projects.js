/**
 * Shared project catalog — single source of truth for every project/tool that
 * lives under the /projects umbrella. Keep the paths in sync with the routes
 * declared in App.js. `art` points at the AI-generated artwork in
 * frontend/src/assets/art/ (see docs/guides/FRONTEND_UI_STANDARD.md §5).
 *
 * Used by the /projects page and the homepage's "Start with a tool you'll
 * love" ranking section.
 */

import artFluid from '../assets/art/project-fluid.jpg';
import art2048 from '../assets/art/project-2048.jpg';
import artColosseum from '../assets/art/Hero banner.jpg';
import artSonic from '../assets/art/project-sonic.jpg';
import artWordle from '../assets/art/project-wordle.jpg';
import artPolls from '../assets/art/project-polls.jpg';
import artGames from '../assets/art/feature-games.jpg';
import artEngineering from '../assets/art/feature-engineering.jpg';
import artProductivity from '../assets/art/feature-productivity.jpg';
import artSurprises from '../assets/art/feature-surprises.jpg';
import artHype from '../assets/art/project-hype.jpg';
import artNet from '../assets/art/project-net.jpg';

export const PROJECTS = [
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
    description: "A falling-sand powder playground — pour sand, water, oil, fire and more, then watch them tumble, flow and react.",
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
  {
    name: "Net",
    path: "/net",
    art: artNet,
    category: "Tools",
    description: "Chat with an AI assistant that can automate tasks, write code, and generate images.",
  },
  {
    name: "UI Mapper",
    path: "/uimapper",
    art: artEngineering,
    category: "Tools",
    description: "Upload a reference screenshot and draw named boxes around components to build a layout spec.",
  },
];
