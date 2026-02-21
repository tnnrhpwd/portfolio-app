function setDarkMode() {
  const theme = 'dark-theme';
  localStorage.setItem('theme', theme);
  if (document.body.classList.contains('light-theme')) {
    document.body.classList.replace('light-theme', theme);
  } else {
    document.body.classList.add(theme);
  }
}

function setLightMode() {
  const theme = 'light-theme';
  localStorage.setItem('theme', theme);
  if (document.body.classList.contains('dark-theme')) {
    document.body.classList.replace('dark-theme', theme);
  } else {
    document.body.classList.add(theme);
  }
}

function setSystemColorMode() {
  const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (prefersDarkScheme) {
    setDarkMode();
  } else {
    setLightMode();
  }
}

/* ── Font Size Scale ── */
const FONT_SCALE_KEY = 'fontSizeScale';
const FONT_SCALE_MIN = 0.8;
const FONT_SCALE_MAX = 1.4;
const FONT_SCALE_DEFAULT = 1;

function setFontSizeScale(scale) {
  const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Number(scale) || FONT_SCALE_DEFAULT));
  document.documentElement.style.setProperty('--font-size-scale', clamped);
  localStorage.setItem(FONT_SCALE_KEY, clamped);
  return clamped;
}

function loadFontSizeScale() {
  const stored = localStorage.getItem(FONT_SCALE_KEY);
  const scale = stored !== null ? parseFloat(stored) : FONT_SCALE_DEFAULT;
  return setFontSizeScale(scale);
}

export {
  setDarkMode,
  setLightMode,
  setSystemColorMode,
  setFontSizeScale,
  loadFontSizeScale,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  FONT_SCALE_DEFAULT,
};
