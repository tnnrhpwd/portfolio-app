import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import './NotFound.css';

function NotFound() {
  return (
    <>
      <Header />
      <main className="not-found">
        <h1 className="not-found__code">404</h1>
        <p className="not-found__message">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="not-found__actions">
          <Link to="/" className="not-found__btn not-found__btn--primary">
            Go Home
          </Link>
          <Link to="/net" className="not-found__btn not-found__btn--secondary">
            Try CSimple
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}

export default NotFound;
