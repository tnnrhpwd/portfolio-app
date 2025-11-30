import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import './NotFound.css';

function NotFound() {
  return (
    <>
      <Header />
      <div className="not-found-container">
        <div className="not-found-content">
          <h1 className="not-found-title">404</h1>
          <h2 className="not-found-subtitle">Page Not Found</h2>
          <p className="not-found-message">
            Sorry, the page you are looking for does not exist or has been
            moved.
          </p>
          <div className="not-found-actions">
            <Link to="/" className="not-found-button">
              Go to Home
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}

export default NotFound;
