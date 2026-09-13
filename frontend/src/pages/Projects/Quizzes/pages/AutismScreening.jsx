import React from 'react';
import QuizPage from '../QuizPage';
import config from '../data/autism';

/** /autism-screening — AQ/RAADS-R-style screening questionnaire. */
function AutismScreening() {
  return <QuizPage quiz={config} />;
}

export default AutismScreening;
