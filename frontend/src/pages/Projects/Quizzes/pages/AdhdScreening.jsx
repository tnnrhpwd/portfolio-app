import React from 'react';
import QuizPage from '../QuizPage';
import config from '../data/adhd';

/** /adhd-screening — ASRS-style self-report scale. */
function AdhdScreening() {
  return <QuizPage quiz={config} />;
}

export default AdhdScreening;
