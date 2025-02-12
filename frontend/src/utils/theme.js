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

export { setDarkMode, setLightMode, setSystemColorMode };
