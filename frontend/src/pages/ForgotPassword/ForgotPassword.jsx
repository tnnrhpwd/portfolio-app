import { useState } from 'react';
import { toast } from 'react-toastify';
import React from 'react';
import './ForgotPassword.css';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';

function ForgotPassword() {
    const [formData, setFormData] = useState({
        email: '',
    });
    const [isLoading, setIsLoading] = useState(false);
    const [emailSent, setEmailSent] = useState(false);

    const { email } = formData;

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
            <Header />
            <div className="planit-forgot-bg">
                <div className="floating-shapes">
                    <div className="floating-circle floating-circle-1"></div>
                    <div className="floating-circle floating-circle-2"></div>
                    <div className="floating-circle floating-circle-3"></div>
                </div>
                <div className="planit-forgot-card">
                    <section className="planit-forgot-heading">
                        <div className="planit-forgot-heading-title">
                            {emailSent ? 'Email Sent!' : 'Forgot Password?'}
                        </div>
                        <div className="planit-forgot-heading-description">
                            {emailSent 
                                ? 'Check your inbox for password reset instructions.'
                                : 'Enter your email address and we\'ll send you a link to reset your password.'
                            }
                        </div>
                    </section>
                    
                    {!emailSent ? (
                        <section className="planit-forgot-form">
                            <form onSubmit={onSubmit} autoComplete="on">
                                <div className="planit-forgot-form-group">
                                    <input
                                        type="email"
                                        className="planit-forgot-form-control"
                                        id="planit-email"
                                        name="email"
                                        value={email}
                                        placeholder="Enter your email"
                                        onChange={onChange}
                                        autoFocus
                                        required
                                    />
                                </div>
                                <div className="planit-forgot-form-group">
                                    <button 
                                        type="submit" 
                                        className="planit-forgot-form-submit" 
                                        disabled={isLoading}
                                    >
                                        {isLoading ? 'Sending...' : 'Send Reset Email'}
                                    </button>
                                </div>
                            </form>
                        </section>
                    ) : (
                        <div className="planit-forgot-success">
                            <p>If an account exists with that email address, you will receive a password reset link shortly.</p>
                            <p>Didn't receive an email? Check your spam folder or try again with a different email address.</p>
                        </div>
                    )}
                    
                    <div className="planit-forgot-actions">
                        <a href="/login">
                            <button className="planit-forgot-back">Back to Login</button>
                        </a>
                        <a href="/register">
                            <button className="planit-forgot-register">Don't have an account? Register</button>
                        </a>
                    </div>
                </div>
            </div>
            <Footer />
        </>
    );
}

export default ForgotPassword;
