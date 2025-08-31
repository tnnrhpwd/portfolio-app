import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import React from 'react';
import './ResetPassword.css';
import Header from '../../components/Header/Header.jsx';
import Footer from '../../components/Footer/Footer.jsx';

function ResetPassword() {
    const [formData, setFormData] = useState({
        password: '',
        confirmPassword: '',
    });
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    const { password, confirmPassword } = formData;
    const token = searchParams.get('token');

    useEffect(() => {
        if (!token) {
            toast.error('Invalid reset link. Please request a new password reset.');
            navigate('/forgot-password');
        }
    }, [token, navigate]);

    const onChange = (e) => {
        setFormData((prevState) => ({
            ...prevState,
            [e.target.name]: e.target.value,
        }));
    };

    const onSubmit = async (e) => {
        e.preventDefault();
        
        if (!password.trim()) {
            toast.error("Please enter a new password.", { autoClose: 3000 });
            return;
        }
        
        if (password.length < 6) {
            toast.error("Password must be at least 6 characters long.", { autoClose: 3000 });
            return;
        }
        
        if (password !== confirmPassword) {
            toast.error("Passwords do not match.", { autoClose: 3000 });
            return;
        }

        setIsLoading(true);
        
        try {
            const response = await fetch('/api/data/reset-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    token: token,
                    password: password.trim()
                })
            });

            const data = await response.json();

            if (response.ok) {
                toast.success("Password reset successfully! You can now log in with your new password.", {
                    autoClose: 5000
                });
                navigate('/login');
            } else {
                toast.error(data.message || "Failed to reset password. Please try again.", {
                    autoClose: 4000
                });
            }
        } catch (error) {
            console.error('Reset password error:', error);
            toast.error("An error occurred. Please try again later.", {
                autoClose: 4000
            });
        } finally {
            setIsLoading(false);
        }
    };

    if (!token) {
        return null; // Will redirect in useEffect
    }

    return (
        <>
            <Header />
            <div className="planit-reset-bg">
                <div className="floating-shapes">
                    <div className="floating-circle floating-circle-1"></div>
                    <div className="floating-circle floating-circle-2"></div>
                    <div className="floating-circle floating-circle-3"></div>
                </div>
                <div className="planit-reset-card">
                    <section className="planit-reset-heading">
                        <div className="planit-reset-heading-title">Reset Your Password</div>
                        <div className="planit-reset-heading-description">
                            Enter your new password below to reset your account password.
                        </div>
                    </section>
                    
                    <section className="planit-reset-form">
                        <form onSubmit={onSubmit} autoComplete="on">
                            <div className="planit-reset-form-group">
                                <div className="planit-reset-password-wrapper">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        className="planit-reset-form-control"
                                        id="planit-password"
                                        name="password"
                                        value={password}
                                        placeholder="Enter new password"
                                        onChange={onChange}
                                        autoFocus
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="planit-reset-showhide"
                                        onClick={() => setShowPassword((show) => !show)}
                                        tabIndex={0}
                                        aria-label={showPassword ? "Hide password" : "Show password"}
                                    >
                                        {showPassword ? "🙈" : "👁️"}
                                    </button>
                                </div>
                            </div>
                            <div className="planit-reset-form-group">
                                <div className="planit-reset-password-wrapper">
                                    <input
                                        type={showConfirmPassword ? "text" : "password"}
                                        className="planit-reset-form-control"
                                        id="planit-confirm-password"
                                        name="confirmPassword"
                                        value={confirmPassword}
                                        placeholder="Confirm new password"
                                        onChange={onChange}
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="planit-reset-showhide"
                                        onClick={() => setShowConfirmPassword((show) => !show)}
                                        tabIndex={0}
                                        aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                                    >
                                        {showConfirmPassword ? "🙈" : "👁️"}
                                    </button>
                                </div>
                            </div>
                            <div className="planit-reset-form-group">
                                <button 
                                    type="submit" 
                                    className="planit-reset-form-submit" 
                                    disabled={isLoading}
                                >
                                    {isLoading ? 'Resetting Password...' : 'Reset Password'}
                                </button>
                            </div>
                        </form>
                    </section>
                    
                    <div className="planit-reset-actions">
                        <a href="/login">
                            <button className="planit-reset-back">Back to Login</button>
                        </a>
                    </div>
                </div>
            </div>
            <Footer />
        </>
    );
}

export default ResetPassword;
