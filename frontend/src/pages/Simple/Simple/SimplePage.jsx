import { Link } from 'react-router-dom';
import Header from '../../../components/Header/Header.jsx';
import Footer from '../../../components/Footer/Footer.jsx';
import SEO from '../../../components/SEO/SEO.jsx';
import SimpleDashboard from './SimpleDashboard';
import './SimplePage.css';

function SimplePage() {
  return (
    <>
      <SEO
        title="Simple"
        description="Simple is an AI agent for your Windows PC — a live Observe, Orient, Goal, Plan, Execute dashboard to run goals, macros, and chat."
        path="/simple"
      />
      <Header />

      <div className="simple">
        <div className="simple-floating" aria-hidden="true">
          <div className="simple-circle simple-circle-1" />
          <div className="simple-circle simple-circle-2" />
          <div className="simple-circle simple-circle-3" />
        </div>

        {/* Hero */}
        <section className="simple-hero">
          <div className="simple-title-wrap">
            <p className="simple-eyebrow">AI agent for Windows</p>
            <h1 className="simple-title">Simple</h1>
            <p className="simple-subtitle">
              Your agent dashboard — goals, macros, and chat in one place.
            </p>
            <Link className="simple-btn simple-btn-outline" to="/pricing">
              See pricing
            </Link>
          </div>
        </section>

        {/* Live mission control — active goals, macros, agent + mini chat */}
        <SimpleDashboard />
      </div>

      <Footer />
    </>
  );
}

export default SimplePage;
