import React, { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import './App.css';
import Home from './components/Home/Home';
import Projects from './components/Projects/Projects';
import Contact from './components/Contact/Contact';
import NavBar from './components/NavBar/NavBar';
import LoginForm from './components/LoginForm/LoginForm';
import ProdPartners from './components/ProdPartners/ProdPartners';
import PollBox from './components/PollBox/PollBox';
import Drafting from "./components/Drafting/Drafting";
import Annuities from './components/Annuities/Annuities';


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
        <Route path="/projects" element={<Projects/>} />
        <Route path="/contact" element={<Contact/>} />
        <Route path="/prodpartners" element={<ProdPartners/>} />
        <Route path="/pollbox" element={<PollBox/>} />
        <Route path="/drafting" element={<Drafting/>} />
        <Route path="/annuities" element={<Annuities/>} />
      </Routes>
    </div>
  );
}

export default App;
