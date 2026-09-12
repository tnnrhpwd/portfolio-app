import React from 'react';
import './ErrorBoundary.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null,
      errorId: null 
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { 
      hasError: true,
      errorId: Date.now().toString(36) + Math.random().toString(36).substr(2)
    };
  }

  componentDidCatch(error, errorInfo) {
    // Log error details
    console.error('Error caught by boundary:', error, errorInfo);
    
    this.setState({
      error,
      errorInfo
    });

    // Log to external service in production
    if (process.env.NODE_ENV === 'production') {
      this.logErrorToService(error, errorInfo);
    }
  }

  // When the route changes (resetKey prop changes), clear the error state so a
  // transient failure on one page doesn't permanently brick the app — the next
  // render retries the (new) route without needing a full page reload.
  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null, errorInfo: null, errorId: null });
    }
  }

  logErrorToService = (error, errorInfo) => {
    // You can integrate with services like Sentry, LogRocket, etc.
    const errorData = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      userId: this.getUserId()
    };

    // Example: Send to your logging endpoint
    fetch('/api/log-error', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(errorData)
    }).catch(err => {
      console.error('Failed to log error to service:', err);
    });
  };

  getUserId = () => {
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      return user?._id || 'anonymous';
    } catch {
      return 'anonymous';
    }
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary" role="alert">
          {/* Decorative ambience — the same floating circles the Discovery pages use. */}
          <div className="error-boundary-floating" aria-hidden="true">
            <div className="error-boundary-circle error-boundary-circle-1" />
            <div className="error-boundary-circle error-boundary-circle-2" />
            <div className="error-boundary-circle error-boundary-circle-3" />
          </div>

          {/* The message, on one flat plane of color (§5: no glass, no borders). */}
          <div className="error-boundary-content">
            <p className="error-boundary-eyebrow">Something broke</p>
            {/* Decorative — the <h1> below is what a screen reader should read. */}
            <div className="error-boundary-code" aria-hidden="true">!</div>
            <h1 className="error-boundary-title">Something went wrong</h1>
            <p className="error-boundary-message">
              This part of the site hit an unexpected error. Refreshing usually clears
              it up — if it keeps happening, the error ID below is worth passing on.
            </p>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="error-boundary-details">
                <summary>Error details (development only)</summary>
                <div className="error-boundary-error-info">
                  <h3>Error</h3>
                  <pre>{this.state.error.toString()}</pre>

                  <h3>Component stack</h3>
                  <pre>{this.state.errorInfo?.componentStack}</pre>

                  <h3>Stack trace</h3>
                  <pre>{this.state.error.stack}</pre>
                </div>
              </details>
            )}

            <div className="error-boundary-actions">
              <button
                type="button"
                onClick={this.handleReload}
                className="error-boundary-button"
              >
                Refresh page
              </button>
              {/* A real <a> on purpose: a full page load is what we want here, and it
                  still works if React's event system is the thing that broke. */}
              <a className="error-boundary-button error-boundary-button-secondary" href="/">
                Go to home
              </a>
            </div>

            <p className="error-boundary-error-id">
              Error ID: {this.state.errorId}
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
