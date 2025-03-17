import React, { useState } from 'react';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import './Terms.css';

const Terms = () => {
    const [activeSection, setActiveSection] = useState("introduction");

    const scrollToSection = (sectionId) => {
        setActiveSection(sectionId);
        document.getElementById(sectionId).scrollIntoView({ behavior: 'smooth' });
    };

    return (<>
        <Header />
        <div className="terms">
            <div className='terms-header'>
                <h1 className='terms-title'>Terms of Service</h1>
                <p className='terms-subtitle'>Last Updated: Mar 2025</p>
            </div>

            <div className="terms-container">
                <div className="terms-navigation">
                    <h3>Contents</h3>
                    <ul>
                        <li className={activeSection === "introduction" ? "active" : ""}>
                            <button onClick={() => scrollToSection("introduction")}>Introduction</button>
                        </li>
                        <li className={activeSection === "acceptance" ? "active" : ""}>
                            <button onClick={() => scrollToSection("acceptance")}>1. Acceptance of Terms</button>
                        </li>
                        <li className={activeSection === "accounts" ? "active" : ""}>
                            <button onClick={() => scrollToSection("accounts")}>2. User Accounts</button>
                        </li>
                        <li className={activeSection === "subscriptions" ? "active" : ""}>
                            <button onClick={() => scrollToSection("subscriptions")}>3. Subscription Plans</button>
                        </li>
                        <li className={activeSection === "payments" ? "active" : ""}>
                            <button onClick={() => scrollToSection("payments")}>4. Payments & Billing</button>
                        </li>
                        <li className={activeSection === "privacy" ? "active" : ""}>
                            <button onClick={() => scrollToSection("privacy")}>5. Privacy & Data</button>
                        </li>
                        <li className={activeSection === "conduct" ? "active" : ""}>
                            <button onClick={() => scrollToSection("conduct")}>6. User Conduct</button>
                        </li>
                        <li className={activeSection === "intellectual" ? "active" : ""}>
                            <button onClick={() => scrollToSection("intellectual")}>7. Intellectual Property</button>
                        </li>
                        <li className={activeSection === "termination" ? "active" : ""}>
                            <button onClick={() => scrollToSection("termination")}>8. Termination</button>
                        </li>
                        <li className={activeSection === "disclaimer" ? "active" : ""}>
                            <button onClick={() => scrollToSection("disclaimer")}>9. Disclaimers & Limitations</button>
                        </li>
                    </ul>
                </div>

                <div className="terms-content">
                    <section id="introduction" className="terms-section">
                        <div className="section-icon">📝</div>
                        <div className="section-content">
                            <p>
                                Welcome to our platform! These Terms of Service govern your access to and use of our 
                                website, API services, and subscription offerings. Please read these terms carefully 
                                before using our services as they constitute a legally binding agreement between you 
                                and us.
                            </p>
                        </div>
                    </section>

                    <section id="acceptance" className="terms-section">
                        <div className="section-icon">✓</div>
                        <div className="section-content">
                            <h2>1. Acceptance of Terms</h2>
                            <p>
                                By accessing or using our platform, you acknowledge that you have read, understood, 
                                and agree to be bound by these Terms of Service. If you do not agree with any part 
                                of these terms, please do not use our services.
                            </p>
                            <p>
                                We may modify these Terms at any time without prior notice. Your continued use of 
                                the platform following any changes constitutes your acceptance of the revised Terms.
                            </p>
                        </div>
                    </section>

                    <section id="accounts" className="terms-section">
                        <div className="section-icon">👤</div>
                        <div className="section-content">
                            <h2>2. User Accounts</h2>
                            <p>
                                To access certain features of our platform, you must create an account. You are 
                                responsible for maintaining the confidentiality of your account credentials and 
                                for all activities that occur under your account.
                            </p>
                            <p>
                                You agree to provide accurate, current, and complete information during the 
                                registration process and to update such information to keep it accurate, current, and complete.
                            </p>
                        </div>
                    </section>

                    <section id="subscriptions" className="terms-section">
                        <div className="section-icon">🔄</div>
                        <div className="section-content">
                            <h2>3. Subscription Plans</h2>
                            <p>
                                Our platform offers various subscription plans, including Free, Flex, and Premium options. 
                                Each plan provides different levels of access, usage limits, and features as described 
                                on our pricing page.
                            </p>
                            <h3>3.1 Free Tier</h3>
                            <p>
                                Our Free tier provides limited access to our services with restricted API calls. This tier 
                                is intended for evaluation purposes and personal use.
                            </p>
                            <h3>3.2 Flex Membership</h3>
                            <p>
                                Our Flex tier operates on a usage-based pricing model. You will be charged a base rate plus 
                                additional fees for usage beyond your included quota. The current rate is $10/month with a 
                                quota of 10,000 API calls and $0.001 per additional call.
                            </p>
                            <h3>3.3 Premium Membership</h3>
                            <p>
                                Our Premium tier offers custom pricing based on your specific needs and volume requirements. 
                                Premium memberships include priority processing, advanced features, and dedicated support.
                            </p>
                        </div>
                    </section>

                    <section id="payments" className="terms-section">
                        <div className="section-icon">💳</div>
                        <div className="section-content">
                            <h2>4. Payments & Billing</h2>
                            <h3>4.1 Payment Processing</h3>
                            <p>
                                We use Stripe as our payment processor. By providing your payment information, you authorize 
                                us to charge your payment method for all fees related to your subscription and usage.
                            </p>
                            <h3>4.2 Subscription Billing</h3>
                            <p>
                                For paid plans, you will be billed on a recurring basis based on your chosen subscription cycle. 
                                Usage-based charges will be calculated at the end of each billing period.
                            </p>
                            <h3>4.3 Refunds</h3>
                            <p>
                                We may provide refunds at our discretion. For usage-based plans, you are responsible for all 
                                usage charges incurred prior to cancellation.
                            </p>
                            <h3>4.4 Plan Changes</h3>
                            <p>
                                You may upgrade or downgrade your subscription plan at any time. Changes will take effect 
                                at the beginning of the next billing cycle unless otherwise specified.
                            </p>
                        </div>
                    </section>

                    <section id="privacy" className="terms-section">
                        <div className="section-icon">🔒</div>
                        <div className="section-content">
                            <h2>5. Privacy & Data</h2>
                            <p>
                                Your use of our services is governed by our Privacy Policy, which describes how we 
                                collect, use, and protect your information. By using our services, you consent to 
                                the collection and processing of your information as described in our Privacy Policy.
                            </p>
                            <p>
                                We implement security measures designed to protect your data, including secure payment 
                                processing through bank-level encryption.
                            </p>
                        </div>
                    </section>

                    <section id="conduct" className="terms-section">
                        <div className="section-icon">⚖️</div>
                        <div className="section-content">
                            <h2>6. User Conduct</h2>
                            <p>
                                You agree to use our services for lawful purposes and in accordance with these terms. 
                                You are prohibited from:
                            </p>
                            <ul>
                                <li>Using our services for any illegal purpose</li>
                                <li>Attempting to interfere with, compromise, or disrupt our services</li>
                                <li>Circumventing usage limits or quotas</li>
                                <li>Sharing your account credentials with others</li>
                                <li>Reverse engineering or attempting to extract our source code</li>
                            </ul>
                        </div>
                    </section>

                    <section id="intellectual" className="terms-section">
                        <div className="section-icon">©</div>
                        <div className="section-content">
                            <h2>7. Intellectual Property</h2>
                            <p>
                                All content provided on our platform, including text, graphics, logos, button icons, 
                                images, audio clips, digital downloads, data compilations, and software, is the 
                                property of our company or its content suppliers and is protected by international 
                                copyright laws.
                            </p>
                            <p>
                                We grant you a limited, non-exclusive, non-transferable license to use our services 
                                in accordance with these Terms. This license does not include any resale or commercial 
                                use of our services or content.
                            </p>
                        </div>
                    </section>

                    <section id="termination" className="terms-section">
                        <div className="section-icon">🚫</div>
                        <div className="section-content">
                            <h2>8. Termination</h2>
                            <p>
                                We reserve the right to terminate or suspend your account and access to our services 
                                for any reason without notice. Upon termination, your right to use our services will 
                                immediately cease.
                            </p>
                            <p>
                                You may cancel your subscription at any time. For Flex or Premium plans, cancellation 
                                will take effect at the end of your current billing cycle, and you will not be charged 
                                for the following period.
                            </p>
                        </div>
                    </section>

                    <section id="disclaimer" className="terms-section">
                        <div className="section-icon">⚠️</div>
                        <div className="section-content">
                            <h2>9. Disclaimers & Limitations</h2>
                            <p>
                                Our services are provided on an "as is" and "as available" basis. We make no 
                                warranties, expressed or implied, regarding the reliability, availability, or 
                                performance of our services.
                            </p>
                            <p>
                                To the fullest extent permitted by law, we disclaim all warranties, including but 
                                not limited to merchantability, fitness for a particular purpose, and non-infringement.
                            </p>
                            <p>
                                Our liability is limited to the amount you paid for the service in the previous 
                                12-month period.
                            </p>
                        </div>
                    </section>
                </div>
            </div>

            <div className="terms-footer">
                <p>If you have any questions about these Terms, please contact us at support@example.com</p>
            </div>
        </div>
        <Footer />
    </>);
};

export default Terms;