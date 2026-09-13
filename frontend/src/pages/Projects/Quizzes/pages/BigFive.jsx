import React from 'react';
import QuizPage from '../QuizPage';
import config from '../data/bigfive';

/** /big-five — Big Five (OCEAN) personality test. */
function BigFive() {
  return <QuizPage quiz={config} />;
}

export default BigFive;
