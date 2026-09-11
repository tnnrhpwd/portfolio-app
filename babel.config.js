module.exports = {
  presets: [
    "@babel/preset-env",
    // Match Vite's JSX handling: use the automatic runtime so components that
    // rely on it (no `import React`) render under Jest too, instead of throwing
    // "React is not defined" and forcing every component to import React.
    ["@babel/preset-react", { runtime: "automatic" }],
    "@babel/preset-typescript"
  ],
};