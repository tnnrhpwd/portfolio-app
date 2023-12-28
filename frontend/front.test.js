// front.test.js
import 'jest-localstorage-mock';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux'; // Import Provider
import { store } from './src/app/store'; // Import your Redux store
import App from './src/App';
import React from 'react';

describe('Frontend Testing', ()=>{
  it('has a running user-interface', () => {
    render(
        <Provider store={store}>
          <App />
        </Provider> 
      );
  });

  it.todo('can communicate with the server');
    it.todo('can log in');
    it.todo('can get data');
})