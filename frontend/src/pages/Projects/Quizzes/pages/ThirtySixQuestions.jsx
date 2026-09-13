import React from 'react';
import CoupleQuizPage from '../CoupleQuizPage';
import config from '../data/thirtySixQuestions';

/**
 * /36-questions — guided conversation for two. No scoring; the only recorded
 * answers are the two private closeness ratings at the end.
 */
function ThirtySixQuestions() {
  return <CoupleQuizPage quiz={config} />;
}

export default ThirtySixQuestions;
