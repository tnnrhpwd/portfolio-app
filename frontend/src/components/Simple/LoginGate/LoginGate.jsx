import { useNavigate } from 'react-router-dom';
import './LoginGate.css';

/**
 * LoginGate — the shared "sign in to continue" card shown on gated Simple pages
 * (/net, /simple) when the visitor isn't authenticated. Redirects the user back
 * to `redirectTo` after login/registration.
 */
function LoginGate({
  redirectTo = '/net',
  eyebrow = 'Simple',
  title = 'Sign in to continue',
  subtitle = 'Your AI assistant for automating the busywork on your PC.',
}) {
  const navigate = useNavigate();

  return (
    <div className="login-gate">
      <div className="login-gate-card">
        <p className="login-gate-eyebrow">{eyebrow}</p>
        <h2 className="login-gate-title">{title}</h2>
        <p className="login-gate-subtitle">{subtitle}</p>
        <p className="login-gate-note">Free to start — no credit card required.</p>

        <div className="login-gate-actions">
          <button
            type="button"
            className="login-gate-btn login-gate-btn--primary"
            onClick={() => navigate('/login', { state: { redirectTo } })}
          >
            Log in
          </button>
          <button
            type="button"
            className="login-gate-btn login-gate-btn--secondary"
            onClick={() => navigate('/register', { state: { redirectTo } })}
          >
            Create account
          </button>
        </div>
      </div>
    </div>
  );
}

export default LoginGate;
