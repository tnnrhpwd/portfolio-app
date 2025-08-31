import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import Spinner from '../Spinner/Spinner.jsx';

function AuthCallback() {
    const navigate = useNavigate();
    const { provider } = useParams();

    useEffect(() => {
        const handleAuthCallback = async () => {
            try {
                const urlParams = new URLSearchParams(window.location.search);
                const code = urlParams.get('code');
                const state = urlParams.get('state');
                const error = urlParams.get('error');

                // Handle OAuth error
                if (error) {
                    console.error('OAuth error:', error);
                    toast.error(`${provider} authentication was cancelled or failed.`, { autoClose: 4000 });
                    navigate('/login');
                    return;
                }

                // Handle missing authorization code
                if (!code) {
                    console.error('No authorization code received');
                    toast.error('Authentication failed. Please try again.', { autoClose: 3000 });
                    navigate('/login');
                    return;
                }

                // Parse state to determine action (login vs link)
                let parsedState = null;
                try {
                    parsedState = JSON.parse(state || '{}');
                } catch (e) {
                    console.error('Invalid state parameter:', e);
                }

                const action = parsedState?.action || 'login';
                
                console.log(`Processing ${provider} ${action} with code:`, code);
                
                // TODO: Make API call to backend to handle the OAuth callback
                // For now, we'll show a success message and redirect
                
                if (action === 'login') {
                    toast.success(`${provider} login integration is coming soon! Redirecting to login page...`, { autoClose: 3000 });
                    setTimeout(() => navigate('/login'), 3000);
                } else if (action === 'link') {
                    toast.success(`${provider} account linking integration is coming soon! Redirecting to settings...`, { autoClose: 3000 });
                    setTimeout(() => navigate('/settings'), 3000);
                } else {
                    navigate('/login');
                }

                // Example of what the API call might look like:
                // const response = await fetch('/api/auth/callback', {
                //     method: 'POST',
                //     headers: {
                //         'Content-Type': 'application/json',
                //         'Authorization': `Bearer ${userToken}` // if linking
                //     },
                //     body: JSON.stringify({
                //         provider,
                //         code,
                //         action,
                //         userId: parsedState?.userId
                //     })
                // });
                //
                // const result = await response.json();
                //
                // if (response.ok) {
                //     if (action === 'login') {
                //         // Handle successful login
                //         localStorage.setItem('user', JSON.stringify(result.user));
                //         navigate('/');
                //     } else {
                //         // Handle successful account linking
                //         navigate('/settings');
                //     }
                //     toast.success(`${provider} ${action} successful!`);
                // } else {
                //     throw new Error(result.message || `${provider} ${action} failed`);
                // }

            } catch (error) {
                console.error(`${provider} authentication error:`, error);
                toast.error(`Failed to complete ${provider} authentication. Please try again.`, { autoClose: 4000 });
                navigate('/login');
            }
        };

        // Add a small delay to ensure the popup has fully loaded
        const timeout = setTimeout(handleAuthCallback, 1000);
        
        return () => clearTimeout(timeout);
    }, [provider, navigate]);

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            background: 'var(--bg-1)',
            color: 'var(--text-color)',
            textAlign: 'center',
            padding: '2rem'
        }}>
            <Spinner />
            <h2 style={{ marginTop: '2rem', fontSize: 'calc(var(--nav-size) * 0.4)' }}>
                🔐 Completing {provider} Authentication...
            </h2>
            <p style={{ 
                marginTop: '1rem', 
                fontSize: 'calc(var(--nav-size) * 0.25)',
                color: 'var(--text-color-accent)'
            }}>
                Please wait while we process your {provider} authentication.
            </p>
        </div>
    );
}

export default AuthCallback;
