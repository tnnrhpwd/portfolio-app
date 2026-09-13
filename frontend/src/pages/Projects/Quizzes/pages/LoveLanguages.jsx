import React from 'react';
import QuizPage from '../QuizPage';
import config from '../data/loveLanguages';

/** /love-languages — the five love languages. */
function LoveLanguages() {
  return <QuizPage quiz={config} />;
}

export default LoveLanguages;
