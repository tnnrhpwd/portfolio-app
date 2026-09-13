import React from 'react';
import QuizPage from '../QuizPage';
import config from '../data/mbti';

/**
 * /mbti — 16 Personality Types.
 * Its own route and its own lazily-loaded bundle; the flow itself is shared.
 */
function MBTI() {
  return <QuizPage quiz={config} />;
}

export default MBTI;
