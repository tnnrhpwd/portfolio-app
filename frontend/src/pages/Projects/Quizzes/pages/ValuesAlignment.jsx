import React from 'react';
import CoupleQuizPage from '../CoupleQuizPage';
import config from '../data/valuesAlignment';

/**
 * /values-alignment — couples quiz. Both partners answer the same scored items,
 * then the two sets of answers are compared.
 */
function ValuesAlignment() {
  return <CoupleQuizPage quiz={config} />;
}

export default ValuesAlignment;
