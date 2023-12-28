import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';     
import Annuities from './pages/Projects/Annuities/Annuities';
import BoggleBox from './pages/Projects/BoggleBox/BoggleBox';
import Contact from './pages/Contact/Contact';
import Drafting from "./pages/Projects/Drafting/Drafting";
import Ethanol from './pages/Projects/Ethanol/Ethanol';
import GFreq from './pages/Projects/GFreq/GFreq';
import Halfway from './pages/Projects/Halfway/Halfway';
import Home from './pages/Home/Home';
import PollBox from './pages/Projects/PollBox/PollBox';
import PassGen from './pages/Projects/PassGen/PassGen';
import ProdPartners from './pages/Projects/ProdPartners/ProdPartners';
import Projects from './pages/Projects/Projects/Projects';
import SleepAssist from './pages/Projects/SleepAssist/SleepAssist';
import Sountrix from './pages/Projects/Sountrix/Sountrix';
import Wordle from './pages/Projects/Wordle/Wordle';
import WordleSolver from './pages/Projects/WordleSolver/WordleSolver';
import InfoGoal from './pages/SimpleAction/InfoGoal/InfoGoal.jsx';
import InfoPlan from './pages/SimpleAction/InfoPlan/InfoPlan.jsx';
import InfoAction from './pages/SimpleAction/InfoAction/InfoAction.jsx';
import LegalTerms from './pages/LegalTerms.jsx'
import Goals from './pages/SimpleAction/Goals/Goals.jsx'
import Login from './pages/Login/Login.jsx'
import Plans from './pages/SimpleAction/Plans/Plans.jsx'
import Profile from './pages/Profile/Profile.jsx'
import Register from './pages/Register/Register.jsx'
import Settings from './pages/Settings.jsx'
import Net from './pages/SimpleAction/Net/Net.jsx';
import About from './pages/About/About.js'
import Agenda from './pages/SimpleAction/Agenda/Agenda.jsx';
import './App.css';
import Simple from './pages/SimpleAction/Simple/Simple.jsx';

function App() {
  return (<>
    <Router>
    <div className="App">
      <Routes>
        <Route path='/about' element={<About />} />
        <Route path='/agenda' element={<Agenda />} />
        <Route path="/annuities" element={<Annuities/>} />
        <Route path="/boggle" element={<BoggleBox/>} />
        <Route path="/contact" element={<Contact/>} />
        <Route path="/drafting" element={<Drafting/>} />
        <Route path="/ethanol" element={<Ethanol/>} />
        <Route path="/GFreq" element={<GFreq/>} />
        <Route path='/goals' element={<Goals />} />
        <Route path="/halfway" element={<Halfway/>} />
        <Route path="/" element={<Home/>} />
        <Route path='/InfoAction' element={<InfoAction />} />
        <Route path='/InfoGoal' element={<InfoGoal />} />
        <Route path='/InfoPlan' element={<InfoPlan />} />
        <Route path='/LegalTerms' element={<LegalTerms />} />
        <Route path='/login' element={<Login />} />
        <Route path='/net' element={<Net />} />
        <Route path="/passgen" element={<PassGen/>} />
        <Route path='/plans' element={<Plans />} />
        <Route path='/PollBox' element={<PollBox />} />
        <Route path="/prodpartners" element={<ProdPartners/>} />
        <Route path='/profile' element={<Profile />} />
        <Route path="/projects" element={<Projects/>} />
        <Route path='/register' element={<Register />} />
        <Route path='/settings' element={<Settings />} />
        <Route path='simple' element={<Simple />} />
        <Route path="/sleepassist" element={<SleepAssist/>} />
        <Route path="/sountrix" element={<Sountrix/>} />
        <Route path="/wordle" element={<Wordle/>} />
        <Route path="/wordlesolver" element={<WordleSolver/>} /></Routes>
    </div>
    </Router>
    <ToastContainer/>
  </>
  );
}

export default App;