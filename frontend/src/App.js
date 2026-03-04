import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';
import { loadFontSizeScale } from './utils/theme';

// ── Eagerly loaded (critical path – always needed on first paint) ──
import Home from './pages/Home/Home';

// ── Lazy-loaded routes (loaded on demand) ──────────────────────────
const Admin = lazy(() => import('./pages/Admin/Admin'));
const Annuities = lazy(() => import('./pages/Projects/Annuities/Annuities'));
const Contact = lazy(() => import('./pages/Contact/Contact'));
const Ethanol = lazy(() => import('./pages/Projects/Ethanol/Ethanol'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword/ForgotPassword.jsx'));
const GFreq = lazy(() => import('./pages/Projects/GFreq/GFreq'));
const Halfway = lazy(() => import('./pages/Projects/Halfway/Halfway'));
const PassGen = lazy(() => import('./pages/Projects/PassGen/PassGen'));
const ResetPassword = lazy(() => import('./pages/ResetPassword/ResetPassword.jsx'));
const SleepAssist = lazy(() => import('./pages/Projects/SleepAssist/SleepAssist'));
const Sonic = lazy(() => import('./pages/Projects/Sonic/Sonic'));
const Wordle = lazy(() => import('./pages/Projects/Wordle/Wordle'));
const WordleSolver = lazy(() => import('./pages/Projects/WordleSolver/WordleSolver'));
const Login = lazy(() => import('./pages/Login/Login.jsx'));
const NotFound = lazy(() => import('./pages/NotFound/NotFound.jsx'));
const Net = lazy(() => import('./pages/Simple/Net/Net.jsx'));
const Pay = lazy(() => import('./pages/Simple/Pay/Pay.jsx'));
const PaymentSuccess = lazy(() => import('./pages/Simple/Pay/PaymentSuccess.jsx'));
const Plans = lazy(() => import('./pages/Simple/Plans/Plans.jsx'));
const About = lazy(() => import('./pages/Simple/About/About.jsx'));
const Profile = lazy(() => import('./pages/Profile/Profile.jsx'));
const Register = lazy(() => import('./pages/Register/Register.jsx'));
const Settings = lazy(() => import('./pages/Settings/Settings.jsx'));
const Support = lazy(() => import('./pages/Support/Support.jsx'));
const Privacy = lazy(() => import('./pages/Privacy/Privacy.jsx'));
const Terms = lazy(() => import('./pages/Terms/Terms.jsx'));

import 'react-toastify/dist/ReactToastify.css';
import './App.css';

// Apply saved font size scale on app load
loadFontSizeScale();

// ── Route loading spinner ──────────────────────────────────────────
function RouteSpinner() {
  return (
    <div className="route-spinner" role="status" aria-label="Loading page">
      <div className="route-spinner__dot" />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <div className="App">
          <Suspense fallback={<RouteSpinner />}>
            <Routes>
              <Route path='/' element={<Home/>} />
              <Route path='/home' element={<Home/>} />
              <Route path='/about' element={<About />} />
              <Route path='/admin' element={<Admin />} />
              <Route path="/annuities" element={<Annuities/>} />
              <Route path="/contact" element={<Contact/>} />
              <Route path="/ethanol" element={<Ethanol/>} />
              <Route path='/forgot-password' element={<ForgotPassword />} />
              <Route path="/GFreq" element={<GFreq/>} />
              <Route path="/halfway" element={<Halfway/>} />
              <Route path='/login' element={<Login />} />
              <Route path='/net' element={<Net />} />
              <Route path='/pay' element={<Pay />} />
              <Route path='/payment-success' element={<PaymentSuccess />} />
              <Route path="/passgen" element={<PassGen/>} />
              <Route path='/plans' element={<Plans />} />
              <Route path='/privacy' element={<Privacy />} />
              <Route path='/profile' element={<Profile />} />
              <Route path='/register' element={<Register />} />
              <Route path='/reset-password' element={<ResetPassword />} />
              <Route path='/settings' element={<Settings />} />
              <Route path="/sleepassist" element={<SleepAssist/>} />
              <Route path="/sonic" element={<Sonic/>} />
              <Route path='/support' element={<Support />} />
              <Route path='/terms' element={<Terms />} />
              <Route path="/wordle" element={<Wordle/>} />
              <Route path="/wordlesolver" element={<WordleSolver/>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
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