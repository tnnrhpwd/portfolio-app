import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';
import { loadFontSizeScale } from './utils/theme';

// ── Eagerly loaded (critical path – always needed on first paint) ──
import Home from './pages/Home/Home';

// ── Lazy-loaded routes (loaded on demand) ──────────────────────────
const Admin = lazy(() => import('./pages/Admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/Admin/Dashboard'));
const AdminUsers = lazy(() => import('./pages/Admin/Users'));
const AdminBugs = lazy(() => import('./pages/Admin/Bugs'));
const AdminMap = lazy(() => import('./pages/Admin/VisitorMapPage'));
const AdminReviews = lazy(() => import('./pages/Admin/Reviews'));
const AdminData = lazy(() => import('./pages/Admin/DataExplorer'));
const AdminHomeTitle = lazy(() => import('./pages/Admin/HomeTitle'));
const AdminFunnelTester = lazy(() => import('./pages/Admin/FunnelTester'));
const Annuities = lazy(() => import('./pages/Projects/Annuities/Annuities'));
const Colosseum = lazy(() => import('./pages/Projects/Colosseum/Colosseum'));
const Contact = lazy(() => import('./pages/Contact/Contact'));
const DeepStorage = lazy(() => import('./pages/DeepStorage/DeepStorage'));
const Ethanol = lazy(() => import('./pages/Projects/Ethanol/Ethanol'));
const Fluid = lazy(() => import('./pages/Projects/Fluid/Fluid'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword/ForgotPassword.jsx'));
const Game2048 = lazy(() => import('./pages/Projects/Game2048/Game2048'));
const Halfway = lazy(() => import('./pages/Projects/Halfway/Halfway'));
const Hype = lazy(() => import('./pages/Hype/Hype'));
const IQTest = lazy(() => import('./pages/Projects/IQTest/IQTest'));
const Muse = lazy(() => import('./pages/Muse/Muse'));
const PassGen = lazy(() => import('./pages/Projects/PassGen/PassGen'));
const Pets = lazy(() => import('./pages/Pets/Pets'));
const Projects = lazy(() => import('./pages/Projects/Projects/Projects.jsx'));
const ResetPassword = lazy(() => import('./pages/ResetPassword/ResetPassword.jsx'));
const SleepAssist = lazy(() => import('./pages/Projects/SleepAssist/SleepAssist'));
const Sonic = lazy(() => import('./pages/Projects/Sonic/Sonic'));
const TypeTest = lazy(() => import('./pages/TypeTest/TypeTest'));
const Wordle = lazy(() => import('./pages/Projects/Wordle/Wordle'));
const WordleSolver = lazy(() => import('./pages/Projects/WordleSolver/WordleSolver'));
const Login = lazy(() => import('./pages/Login/Login.jsx'));
const NotFound = lazy(() => import('./pages/NotFound/NotFound.jsx'));
const Net = lazy(() => import('./pages/Simple/Net/Net.jsx'));
const Pay = lazy(() => import('./pages/Simple/Pay/Pay.jsx'));
const PaymentSuccess = lazy(() => import('./pages/Simple/Pay/PaymentSuccess.jsx'));
const Plans = lazy(() => import('./pages/Simple/Plans/Plans.jsx'));
const GoalDetail = lazy(() => import('./pages/Simple/Plans/GoalDetail.jsx'));
const Polls = lazy(() => import('./pages/Simple/Polls/Polls.jsx'));
const About = lazy(() => import('./pages/Simple/About/About.jsx'));
const Pricing = lazy(() => import('./pages/Pricing/Pricing.jsx'));
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

// Keys the error boundary by the current location so navigating to a new
// route clears a transient error instead of leaving the app bricked.
function RouteErrorBoundary({ children }) {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname + location.search}>
      {children}
    </ErrorBoundary>
  );
}

function App() {
  return (
    <Router>
      <RouteErrorBoundary>
        <div className="App">
          <Suspense fallback={<RouteSpinner />}>
            <Routes>
              <Route path='/' element={<Home/>} />
              <Route path='/home' element={<Home/>} />
              <Route path='/about' element={<About />} />
              <Route path='/admin' element={<Admin />}>
                <Route index element={<AdminDashboard />} />
                <Route path='users' element={<AdminUsers />} />
                <Route path='bugs' element={<AdminBugs />} />
                <Route path='map' element={<AdminMap />} />
                <Route path='reviews' element={<AdminReviews />} />
                <Route path='data' element={<AdminData />} />
                <Route path='home-title' element={<AdminHomeTitle />} />
                <Route path='funnel-tester' element={<AdminFunnelTester />} />
              </Route>
              <Route path="/annuities" element={<Annuities/>} />
              <Route path="/contact" element={<Contact/>} />
              <Route path='/deepstorage' element={<DeepStorage />} />
              <Route path="/ethanol" element={<Ethanol/>} />
              <Route path="/fluid" element={<Fluid/>} />
              <Route path='/forgot-password' element={<ForgotPassword />} />
              <Route path="/2048" element={<Game2048/>} />
              <Route path="/colosseum" element={<Colosseum/>} />
              <Route path="/Colosseum" element={<Colosseum/>} />
              <Route path="/halfway" element={<Halfway/>} />
              <Route path='/hype' element={<Hype />} />
              <Route path="/iq" element={<IQTest/>} />
              <Route path='/login' element={<Login />} />
              <Route path='/muse' element={<Muse />} />
              <Route path='/net' element={<Net />} />
              <Route path='/pay' element={<Pay />} />
              <Route path='/payment-success' element={<PaymentSuccess />} />
              <Route path="/passgen" element={<PassGen/>} />
              <Route path="/pets" element={<Pets/>} />
              <Route path='/projects' element={<Projects />} />
              <Route path='/plans' element={<Plans />} />
              <Route path='/plans/goal/:id' element={<GoalDetail />} />
              <Route path='/polls' element={<Polls />} />
              <Route path='/pricing' element={<Pricing />} />
              <Route path='/privacy' element={<Privacy />} />
              <Route path='/profile' element={<Profile />} />
              <Route path='/register' element={<Register />} />
              <Route path='/reset-password' element={<ResetPassword />} />
              <Route path='/settings' element={<Settings />} />
              <Route path="/sleepassist" element={<SleepAssist/>} />
              <Route path="/sonic" element={<Sonic/>} />
              <Route path='/support' element={<Support />} />
              <Route path='/type' element={<TypeTest/>} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/wordle" element={<Wordle/>} />
              <Route path="/wordlesolver" element={<WordleSolver/>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </div>
      </RouteErrorBoundary>
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
    </Router>
  );
}

export default App;