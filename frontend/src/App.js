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
import Sonic from './pages/Projects/Sonic/Sonic';
import Wordle from './pages/Projects/Wordle/Wordle';
import WordleSolver from './pages/Projects/WordleSolver/WordleSolver';
import InfoGoal from './pages/Simple/InfoGoal/InfoGoal.jsx';
import InfoPlan from './pages/Simple/InfoPlan/InfoPlan.jsx';
import InfoAction from './pages/Simple/InfoAction/InfoAction.jsx';
import LegalTerms from './pages/LegalTerms.jsx'
import Goals from './pages/Simple/Goals/Goals.jsx'
import Login from './pages/Login/Login.jsx'
import Plans from './pages/Simple/Plans/Plans.jsx'
import Profile from './pages/Profile/Profile.jsx'
import Register from './pages/Register/Register.jsx'
import Settings from './pages/Settings.jsx'
import Net from './pages/Simple/Net/Net.jsx';
import About from './pages/Simple/About/About.jsx'
import Agenda from './pages/Simple/Agenda/Agenda.jsx';
import Simple from './pages/Simple/Simple/Simple.jsx';
import Privacy from './pages/Privacy/Privacy.jsx';
import Terms from './pages/Terms/Terms.jsx';
import 'react-toastify/dist/ReactToastify.css'                                // styling
import './App.css';

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
          <Route path="/home" element={<Home/>} />
          <Route path='/InfoAction' element={<InfoAction />} />
          <Route path='/InfoGoal' element={<InfoGoal />} />
          <Route path='/InfoPlan' element={<InfoPlan />} />
          <Route path='/LegalTerms' element={<LegalTerms />} />
          <Route path='/login' element={<Login />} />
          <Route path='/net' element={<Net />} />
          <Route path="/passgen" element={<PassGen/>} />
          <Route path='/plans' element={<Plans />} />
          <Route path='/PollBox' element={<PollBox />} />
          <Route path='/privacy' element={<Privacy />} />
          <Route path="/prodpartners" element={<ProdPartners/>} />
          <Route path='/profile' element={<Profile />} />
          <Route path="/projects" element={<Projects/>} />
          <Route path='/register' element={<Register />} />
          <Route path='/settings' element={<Settings />} />
          <Route path='/Simple' element={<Simple />} />
          <Route path="/sleepassist" element={<SleepAssist/>} />
          <Route path="/sonic" element={<Sonic/>} />
          <Route path='/terms' element={<Terms />} />
          <Route path="/wordle" element={<Wordle/>} />
          <Route path="/wordlesolver" element={<WordleSolver/>} />
          </Routes>
      </div>
    </Router>
    <ToastContainer/>
  </>
  );
}

export default App;