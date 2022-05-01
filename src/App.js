import React from 'react';
import { Routes, Route } from 'react-router-dom';
import './App.css';

import Annuities from './components/Annuities/Annuities';
import Contact from './components/Contact/Contact';
import Drafting from "./components/Drafting/Drafting";
import Ethanol from './components/Ethanol/Ethanol';
import Home from './components/Home/Home';

import PollBox from './components/PollBox/PollBox';
import ProdPartners from './components/ProdPartners/ProdPartners';
import Projects from './components/Projects/Projects';
import Wordle from './components/Wordle/Wordle';
import WordleSolver from './components/WordleSolver/WordleSolver';

function App() {


  return (
    <div className="App">
      
      <Routes>
        <Route path="/" element={<Home/>} />
        <Route path="/ethanol" element={<Ethanol/>} />
        <Route path="/annuities" element={<Annuities/>} />
        <Route path="/contact" element={<Contact/>} />
        <Route path="/drafting" element={<Drafting/>} />
        <Route path="/prodpartners" element={<ProdPartners/>} />
        <Route path="/projects" element={<Projects/>} />
        <Route path="/pollbox" element={<PollBox/>} />
        <Route path="/wordlesolver" element={<WordleSolver/>} />
        <Route path="/wordle" element={<Wordle/>} />
      </Routes>
    </div>
  );
}

export default App;
