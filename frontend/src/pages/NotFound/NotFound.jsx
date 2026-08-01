import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO.jsx';
import '../Home/Home.css';
import './NotFound.css';

function NotFound() {
  return (
    <>
      <SEO
        title="Page Not Found"
        description="The page you're looking for doesn't exist or has been moved."
        path="/404"
        noindex
      />
      <Header />
      <div className="container">
        {/* Floating elements to match the Home page's ambience */}
        <div className="floating-shapes">
          <div className="floating-circle floating-circle-1"></div>
          <div className="floating-circle floating-circle-2"></div>
          <div className="floating-circle floating-circle-3"></div>
        </div>

        <section className="section-tile hero-section not-found-section">
          <div id="content-tile" className="not-found-tile">
            <div className="not-found-code">404</div>
            <div id="text-body" className="not-found-message">
              The page you're looking for doesn't exist or has been moved.
            </div>
            <div id="text-subtext" className="not-found-subtext">
              Double-check the URL, or head back to somewhere familiar.
            </div>
            <div className="not-found-actions">
              <Link to="/" id="content-button" className="not-found-btn">
                Go Home
              </Link>
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}

export default NotFound;
