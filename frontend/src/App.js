import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';
import Admin from './pages/Admin/Admin';
import Annuities from './pages/Projects/Annuities/Annuities';
import Contact from './pages/Contact/Contact';
import Ethanol from './pages/Projects/Ethanol/Ethanol';
import ForgotPassword from './pages/ForgotPassword/ForgotPassword.jsx';
import GFreq from './pages/Projects/GFreq/GFreq';
import Halfway from './pages/Projects/Halfway/Halfway';
import Home from './pages/Home/Home';
import PassGen from './pages/Projects/PassGen/PassGen';
import ResetPassword from './pages/ResetPassword/ResetPassword.jsx';
import SleepAssist from './pages/Projects/SleepAssist/SleepAssist';
import Sonic from './pages/Projects/Sonic/Sonic';
import Wordle from './pages/Projects/Wordle/Wordle';
import WordleSolver from './pages/Projects/WordleSolver/WordleSolver';
import InfoData from './pages/Simple/InfoData/InfoData.jsx';
import LegalTerms from './pages/LegalTerms.jsx'
import Login from './pages/Login/Login.jsx'
import Pay from './pages/Simple/Pay/Pay.jsx'
import Plans from './pages/Simple/Plans/Plans.jsx'
import Profile from './pages/Profile/Profile.jsx'
import Register from './pages/Register/Register.jsx'
import Settings from './pages/Settings/Settings.jsx'
import Net from './pages/Simple/Net/Net.jsx';
import About from './pages/Simple/About/About.jsx'
import Simple from './pages/Simple/Simple/Simple.jsx';
import Support from './pages/Support/Support.jsx';
import Privacy from './pages/Privacy/Privacy.jsx';
import Terms from './pages/Terms/Terms.jsx';
import 'react-toastify/dist/ReactToastify.css';
import './App.css';

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <div className="App">
          <Routes>
            <Route path='/about' element={<About />} />
            <Route path='/admin' element={<Admin />} />
            <Route path="/annuities" element={<Annuities/>} />
            <Route path="/contact" element={<Contact/>} />
            <Route path="/ethanol" element={<Ethanol/>} />
            <Route path='/forgot-password' element={<ForgotPassword />} />
            <Route path="/GFreq" element={<GFreq/>} />
            <Route path="/halfway" element={<Halfway/>} />
            <Route path="/" element={<Home/>} />
            <Route path="/home" element={<Home/>} />
            <Route path='/InfoData/:id' element={<InfoData />} />
            <Route path='/LegalTerms' element={<LegalTerms />} />
            <Route path='/login' element={<Login />} />
            <Route path='/net' element={<Net />} />
            <Route path="/passgen" element={<PassGen/>} />
            <Route path='/pay' element={<Pay />} />
            <Route path='/plans' element={<Plans />} />
            <Route path='/privacy' element={<Privacy />} />
            <Route path='/profile' element={<Profile />} />
            <Route path='/register' element={<Register />} />
            <Route path='/reset-password' element={<ResetPassword />} />
            <Route path='/settings' element={<Settings />} />
            <Route path='/Simple' element={<Simple />} />
            <Route path="/sleepassist" element={<SleepAssist/>} />
            <Route path="/sonic" element={<Sonic/>} />
            <Route path='/support' element={<Support />} />
            <Route path='/terms' element={<Terms />} />
            <Route path="/wordle" element={<Wordle/>} />
            <Route path="/wordlesolver" element={<WordleSolver/>} />
            <Route path="/Simple" element={<Simple/>} />
          </Routes>
        </div>
      </Router>
      <ToastContainer
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
    </ErrorBoundary>
  );
}

export default App;