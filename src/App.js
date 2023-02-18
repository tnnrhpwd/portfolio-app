import React from 'react';
import { Routes, Route } from 'react-router-dom';

import Annuities from './components/Annuities/Annuities';
import BoggleBox from './components/BoggleBox/BoggleBox';
import Contact from './components/Contact/Contact';
import Drafting from "./components/Drafting/Drafting";
import Ethanol from './components/Ethanol/Ethanol';
import Halfway from './components/Halfway/Halfway';
import Home from './components/Home/Home';
import Planit from './components/Planit/Planit';
// import PollBox from './components/PollBox/PollBox';
import PassGen from './components/PassGen/PassGen';
import ProdPartners from './components/ProdPartners/ProdPartners';
import Projects from './components/Projects/Projects';
import SleepAssist from './components/SleepAssist/SleepAssist';
import Wordle from './components/Wordle/Wordle';
import WordleSolver from './components/WordleSolver/WordleSolver';

import './App.css';

function App() {
  return (
    <div className="App">
      <Routes>
        <Route path="/" element={<Home/>} />
        <Route path="/annuities" element={<Annuities/>} />
        <Route path="/contact" element={<Contact/>} />
        <Route path="/drafting" element={<Drafting/>} />
        <Route path="/ethanol" element={<Ethanol/>} />
        <Route path="/halfway" element={<Halfway/>} />
        <Route path="/planit" element={<Planit/>} />
        {/* <Route path="/pollbox" element={<PollBox/>} /> */}
        <Route path="/sleepassist" element={<SleepAssist/>} />
        <Route path="/passgen" element={<PassGen/>} />
        <Route path="/prodpartners" element={<ProdPartners/>} />
        <Route path="/projects" element={<Projects/>} />
        <Route path="/wordle" element={<Wordle/>} />
        <Route path="/wordlesolver" element={<WordleSolver/>} />
        <Route path="/boggle" element={<BoggleBox/>} />
      </Routes>
    </div>
  );
}

export default App;
