import { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import React from 'react';
import { Link } from 'react-router-dom';
import { logout } from '../../features/data/dataSlice';
import './ForgotPassword.css';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';
import SEO from '../../components/SEO/SEO.jsx';

function ForgotPassword() {
    const [formData, setFormData] = useState({
        email: '',
    });
    const [isLoading, setIsLoading] = useState(false);
    const [emailSent, setEmailSent] = useState(false);

    const { email } = formData;

    const dispatch = useDispatch();

    // Clear any stale session so the page starts fresh.
    useEffect(() => {
        localStorage.removeItem('user');
        dispatch(logout());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onChange = (e) => {
        setFormData((prevState) => ({
            ...prevState,
            [e.target.name]: e.target.value,
        }));
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        
        if (!email.trim()) {
            toast.error("Please enter your email address.", { autoClose: 3000 });
            return;
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            toast.error("Please enter a valid email address.", { autoClose: 3000 });
            return;
        }

        setIsLoading(true);
        
        try {
            const response = await fetch('/api/data/forgot-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email: email.trim() })
            });

            const data = await response.json();

            if (response.ok) {
                setEmailSent(true);
                toast.success("Password reset email sent! Please check your inbox.", {
                    autoClose: 5000
                });
            } else {
                toast.error(data.message || "Failed to send password reset email.", {
                    autoClose: 4000
                });
            }
        } catch (error) {
            console.error('Forgot password error:', error);
            toast.error("An error occurred. Please try again later.", {
                autoClose: 4000
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <SEO title="Forgot Password" description="Reset your STHopwood account password." path="/forgot-password" noindex />
            <Header />
            <div className="forgot">
                <div className="forgot-floating" aria-hidden="true">
                    <div className="forgot-circle forgot-circle-1"></div>
                    <div className="forgot-circle forgot-circle-2"></div>
                    <div className="forgot-circle forgot-circle-3"></div>
                </div>

                <section className="forgot-hero">
                    <div className="forgot-title-wrap">
                        <p className="forgot-eyebrow">Account recovery</p>
                        <h1 className="forgot-title">
                            {emailSent ? 'Email Sent!' : 'Forgot Password?'}
                        </h1>
                        <p className="forgot-subtitle">
                            {emailSent
                                ? 'Check your inbox for password reset instructions.'
                                : "Enter your email address and we'll send you a link to reset your password."
                            }
                        </p>
                    </div>
                </section>

                <main id="main" className="forgot-section">
                    <div className="forgot-card">
                        {!emailSent ? (
                            <form onSubmit={onSubmit} autoComplete="on">
                                <div className="forgot-form-group">
                                    <label className="forgot-label" htmlFor="forgot-email">Email</label>
                                    <input
                                        type="email"
                                        className="forgot-input"
                                        id="forgot-email"
                                        name="email"
                                        value={email}
                                        placeholder="you@example.com"
                                        onChange={onChange}
                                        autoFocus
                                        required
                                    />
                                </div>
                                <button
                                    type="submit"
                                    className="forgot-submit"
                                    disabled={isLoading}
                                >
                                    {isLoading ? 'Sending…' : 'Send Reset Email'}
                                </button>
                            </form>
                        ) : (
                            <div className="forgot-success">
                                <p>If an account exists with that email address, you will receive a password reset link shortly.</p>
                                <p>Didn't receive an email? Check your spam folder or try again with a different email address.</p>
                            </div>
                        )}

                        <div className="forgot-actions">
                            <Link className="forgot-link" to="/login">Back to Login</Link>
                            <Link className="forgot-link" to="/register">Don't have an account? Register</Link>
                        </div>
                    </div>
                </main>
            </div>
            <Footer />
        </>
    );
}

export default ForgotPassword;
