import React from 'react';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import './Terms.css';

const Terms = () => {
    return (<>
        <Header />
        <div className="terms">
            <div className='terms-title'>Terms of Service</div>
            <div className="terms-body">
                <div className="terms-body-text">
                    Welcome to our web application! By accessing and using this
                    website, you agree to comply with and be bound by the following
                    terms and conditions. Please read these terms carefully before
                    using our services.
                </div>
                <div className="terms-body-title">1. Acceptance of Terms</div>
                <div className="terms-body-text">
                    By using our web application, you acknowledge that you have read,
                    understood, and agree to be bound by these terms. If you do not
                    agree with any part of these terms, please do not use our services.
                </div>
                <div className="terms-body-title">2. User Registration</div>
                <div className="terms-body-text">
                    To access certain features of our web application, you may be
                    required to register for an account. You are responsible for
                    maintaining the confidentiality of your account information.
                </div>
                <div className="terms-body-title">3. Privacy Policy</div>
                <div className="terms-body-text">
                    Your use of our services is also governed by our Privacy Policy.
                    Please review our Privacy Policy to understand how we collect, use,
                    and protect your information.
                </div>
                <div className="terms-body-title">4. User Conduct</div>
                <div className="terms-body-text">
                    You agree to use our services for lawful purposes and in
                    accordance with these terms. You are prohibited from engaging in
                    any conduct that may disrupt or interfere with our web application.
                </div>
                <div className="terms-body-title">5. Intellectual Property</div>
                <div className="terms-body-text">
                    All content provided on our web application, including text,
                    graphics, logos, button icons, images, audio clips, digital
                    downloads, data compilations, and software, is the property of our
                    company or its content suppliers and is protected by international
                    copyright laws.
                </div>
                <div className="terms-body-title">6. Termination</div>
                <div className="terms-body-text">
                    We reserve the right to terminate or suspend your account and
                    access to our services for any reason without notice.
                </div>
            </div>
        </div>
        <Footer />
    </>);
};

export default Terms;