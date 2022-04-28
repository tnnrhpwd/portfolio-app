import React, { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import './App.css';

import Alcohol from './components/Alcohol/Alcohol';
import Annuities from './components/Annuities/Annuities';
import Contact from './components/Contact/Contact';
import Drafting from "./components/Drafting/Drafting";
import Home from './components/Home/Home';
import LoginForm from './components/LoginForm/LoginForm';
import NavBar from './components/NavBar/NavBar';
import PollBox from './components/PollBox/PollBox';
import ProdPartners from './components/ProdPartners/ProdPartners';
import Projects from './components/Projects/Projects';
import Wordle from './components/Wordle/Wordle';
import WordleSolver from './components/WordleSolver/WordleSolver';

function App() {
  const [isShowLogin, setIsShowLogin] = useState(false);
  const handleLoginClick = () => {
    setIsShowLogin((isShowLogin) => !isShowLogin)
  }

  return (
    <div className="App">
      <NavBar handleLoginClick={handleLoginClick} />
      <LoginForm isShowLogin={isShowLogin} />
      <Routes>
        <Route path="/" element={<Home/>} />
        <Route path="/alcohol" element={<Alcohol/>} />
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
