import React from 'react';
import QuizPage from '../QuizPage';
import config from '../data/enneagram';

/** /enneagram — nine-type Enneagram quiz. */
function Enneagram() {
  return <QuizPage quiz={config} />;
}

export default Enneagram;
