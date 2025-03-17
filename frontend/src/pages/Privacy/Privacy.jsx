import React, { useState } from 'react';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import './Privacy.css';

const Privacy = () => {
    const [activeSection, setActiveSection] = useState("introduction");

    const scrollToSection = (sectionId) => {
        setActiveSection(sectionId);
        document.getElementById(sectionId).scrollIntoView({ behavior: 'smooth' });
    };

    const currentDate = new Date();
    const currentMonth = currentDate.toLocaleString('default', { month: 'short' });
    const currentYear = currentDate.getFullYear();

    return (<>
        <Header />
        <div className="privacy">
            <div className='privacy-header'>
                <h1 className='privacy-title'>Privacy Policy</h1>
                <p className='privacy-subtitle'>Last Updated: {currentMonth} {currentYear}</p>
            </div>

            <div className="privacy-container">
                <div className="privacy-navigation">
                    <h3>Contents</h3>
                    <ul>
                        <li className={activeSection === "introduction" ? "active" : ""}>
                            <button onClick={() => scrollToSection("introduction")}>Introduction</button>
                        </li>
                        <li className={activeSection === "collection" ? "active" : ""}>
                            <button onClick={() => scrollToSection("collection")}>1. Information We Collect</button>
                        </li>
                        <li className={activeSection === "usage" ? "active" : ""}>
                            <button onClick={() => scrollToSection("usage")}>2. How We Use Your Information</button>
                        </li>
                        <li className={activeSection === "payment" ? "active" : ""}>
                            <button onClick={() => scrollToSection("payment")}>3. Payment Processing</button>
                        </li>
                        <li className={activeSection === "security" ? "active" : ""}>
                            <button onClick={() => scrollToSection("security")}>4. Data Security</button>
                        </li>
                        <li className={activeSection === "sharing" ? "active" : ""}>
                            <button onClick={() => scrollToSection("sharing")}>5. Information Sharing</button>
                        </li>
                        <li className={activeSection === "cookies" ? "active" : ""}>
                            <button onClick={() => scrollToSection("cookies")}>6. Cookies & Tracking</button>
                        </li>
                        <li className={activeSection === "rights" ? "active" : ""}>
                            <button onClick={() => scrollToSection("rights")}>7. Your Privacy Rights</button>
                        </li>
                        <li className={activeSection === "updates" ? "active" : ""}>
                            <button onClick={() => scrollToSection("updates")}>8. Policy Updates</button>
                        </li>
                        <li className={activeSection === "contact" ? "active" : ""}>
                            <button onClick={() => scrollToSection("contact")}>9. Contact Us</button>
                        </li>
                    </ul>
                </div>

                <div className="privacy-content">
                    <section id="introduction" className="privacy-section">
                        <div className="section-icon">🔐</div>
                        <div className="section-content">
                            <p>
                                We respect your privacy and are committed to protecting your personal information. 
                                This Privacy Policy explains how we collect, use, disclose, and safeguard your 
                                information when you use our platform and services, including our payment processing functionality.
                            </p>
                            <p>
                                By accessing or using our service, you consent to the collection and use of 
                                information in accordance with this policy.
                            </p>
                        </div>
                    </section>

                    <section id="collection" className="privacy-section">
                        <div className="section-icon">📋</div>
                        <div className="section-content">
                            <h2>1. Information We Collect</h2>
                            
                            <h3>1.1 Personal Information</h3>
                            <p>
                                We collect information that you provide directly to us when you:
                            </p>
                            <ul>
                                <li>Register for an account</li>
                                <li>Subscribe to our services</li>
                                <li>Make a payment</li>
                                <li>Contact our support team</li>
                                <li>Respond to surveys or communications</li>
                            </ul>
                            <p>
                                This information may include your name, email address, phone number, billing 
                                address, and payment details.
                            </p>
                            
                            <h3>1.2 Usage Information</h3>
                            <p>
                                When you access our services, we automatically collect certain information about 
                                your device and usage patterns, including:
                            </p>
                            <ul>
                                <li>IP address and device identifiers</li>
                                <li>Browser type and operating system</li>
                                <li>Pages viewed and features used</li>
                                <li>Time spent on our platform</li>
                                <li>API call volumes and patterns</li>
                            </ul>
                            
                            <h3>1.3 Payment Information</h3>
                            <p>
                                When you make a purchase or subscribe to our paid plans, we collect 
                                payment-related information necessary to process your transaction. This includes:
                            </p>
                            <ul>
                                <li>Payment method details</li>
                                <li>Billing address</li>
                                <li>Transaction history</li>
                            </ul>
                        </div>
                    </section>

                    <section id="usage" className="privacy-section">
                        <div className="section-icon">🔍</div>
                        <div className="section-content">
                            <h2>2. How We Use Your Information</h2>
                            <p>
                                We use the information we collect for various purposes, including:
                            </p>
                            <ul>
                                <li>
                                    <strong>Providing our services:</strong> To operate, maintain, and improve our 
                                    platform and offerings.
                                </li>
                                <li>
                                    <strong>Personalization:</strong> To customize your experience and deliver 
                                    content relevant to your interests and usage patterns.
                                </li>
                                <li>
                                    <strong>Communication:</strong> To respond to your inquiries, send service 
                                    notifications, and provide customer support.
                                </li>
                                <li>
                                    <strong>Subscription management:</strong> To process transactions, manage your 
                                    subscription, and send billing notifications.
                                </li>
                                <li>
                                    <strong>Analytics:</strong> To understand how users interact with our platform 
                                    and improve our services based on this data.
                                </li>
                                <li>
                                    <strong>Security:</strong> To detect and prevent fraudulent activity, unauthorized 
                                    access, and other potential security issues.
                                </li>
                            </ul>
                        </div>
                    </section>

                    <section id="payment" className="privacy-section">
                        <div className="section-icon">💳</div>
                        <div className="section-content">
                            <h2>3. Payment Processing</h2>
                            <p>
                                We use Stripe, a trusted third-party payment processor, to securely handle all payment 
                                transactions on our platform. When you provide payment information:
                            </p>
                            <ul>
                                <li>
                                    Your payment details are encrypted and securely transmitted directly to Stripe 
                                    using industry-standard encryption technology.
                                </li>
                                <li>
                                    We do not store your full credit card details on our servers. Instead, we receive 
                                    and store a token or identifier from Stripe that allows us to process future 
                                    transactions without handling your sensitive payment information.
                                </li>
                                <li>
                                    Billing information and transaction records are retained for legal and accounting 
                                    purposes in accordance with applicable regulations.
                                </li>
                            </ul>
                            <p>
                                Stripe's handling of your payment information is governed by their own privacy policy 
                                and terms of service. We encourage you to review these documents on Stripe's website.
                            </p>
                        </div>
                    </section>

                    <section id="security" className="privacy-section">
                        <div className="section-icon">🔒</div>
                        <div className="section-content">
                            <h2>4. Data Security</h2>
                            <p>
                                We implement appropriate technical and organizational measures to protect your personal 
                                information from unauthorized access, loss, misuse, or alteration. These measures 
                                include:
                            </p>
                            <ul>
                                <li>Encryption of sensitive data both in transit and at rest</li>
                                <li>Regular security assessments and penetration testing</li>
                                <li>Access controls and authentication requirements</li>
                                <li>Monitoring for suspicious activities</li>
                                <li>Employee training on data protection best practices</li>
                            </ul>
                            <p>
                                While we strive to use commercially acceptable means to protect your personal 
                                information, no method of transmission over the internet or electronic storage is 
                                100% secure. We cannot guarantee absolute security of your data.
                            </p>
                        </div>
                    </section>

                    <section id="sharing" className="privacy-section">
                        <div className="section-icon">🤝</div>
                        <div className="section-content">
                            <h2>5. Information Sharing</h2>
                            <p>
                                We do not sell, trade, or otherwise transfer your personal information to external 
                                parties except in the following limited circumstances:
                            </p>
                            <ul>
                                <li>
                                    <strong>Service providers:</strong> We may share information with trusted third 
                                    parties who assist us in operating our website, conducting our business, or 
                                    providing services to you (such as payment processors, cloud hosting providers, 
                                    and customer support tools).
                                </li>
                                <li>
                                    <strong>Legal requirements:</strong> We may disclose information when required by 
                                    law, court order, or other legal process, or if we have a good-faith belief that 
                                    disclosure is necessary to protect our rights, your safety, or the safety of others.
                                </li>
                                <li>
                                    <strong>Business transfers:</strong> In connection with a merger, acquisition, or 
                                    sale of assets, your information may be transferred as part of the business assets.
                                </li>
                                <li>
                                    <strong>With your consent:</strong> We may share information with third parties 
                                    when you explicitly consent to such sharing.
                                </li>
                            </ul>
                            <p>
                                We require all third parties that process data on our behalf to respect the security 
                                of your personal data and to treat it in accordance with applicable laws.
                            </p>
                        </div>
                    </section>

                    <section id="cookies" className="privacy-section">
                        <div className="section-icon">🍪</div>
                        <div className="section-content">
                            <h2>6. Cookies & Tracking</h2>
                            <p>
                                Our service uses essential cookies and similar tracking technologies to enhance your 
                                experience, analyze usage, and assist in our marketing efforts. These technologies may:
                            </p>
                            <ul>
                                <li>Remember your preferences and settings</li>
                                <li>Maintain your authenticated session securely</li>
                                <li>Collect usage data for analytics and improvement</li>
                                <li>Support payment processing functionality</li>
                            </ul>
                            <p>
                                You can control cookies through your browser settings. However, disabling certain 
                                cookies may limit functionality, including the ability to process payments.
                            </p>
                        </div>
                    </section>

                    <section id="rights" className="privacy-section">
                        <div className="section-icon">⚖️</div>
                        <div className="section-content">
                            <h2>7. Your Privacy Rights</h2>
                            <p>
                                Depending on your location, you may have certain rights regarding your personal 
                                information, including:
                            </p>
                            <ul>
                                <li>
                                    <strong>Access:</strong> You can request a copy of the personal information we 
                                    hold about you.
                                </li>
                                <li>
                                    <strong>Correction:</strong> You can ask us to update or correct inaccurate data.
                                </li>
                                <li>
                                    <strong>Deletion:</strong> You can request that we delete your personal information 
                                    in certain circumstances.
                                </li>
                                <li>
                                    <strong>Restriction:</strong> You can ask us to limit how we use your data.
                                </li>
                                <li>
                                    <strong>Data portability:</strong> You can request a copy of your data in a 
                                    structured, commonly used format.
                                </li>
                                <li>
                                    <strong>Objection:</strong> You can object to our processing of your data in 
                                    certain circumstances.
                                </li>
                            </ul>
                            <p>
                                To exercise any of these rights, please contact us using the information provided in 
                                the "Contact Us" section below. We will respond to your request within the timeframe 
                                required by applicable law.
                            </p>
                        </div>
                    </section>

                    <section id="updates" className="privacy-section">
                        <div className="section-icon">🔄</div>
                        <div className="section-content">
                            <h2>8. Policy Updates</h2>
                            <p>
                                We may update this Privacy Policy from time to time to reflect changes in our practices 
                                or for other operational, legal, or regulatory reasons. We will notify you of any 
                                material changes by:
                            </p>
                            <ul>
                                <li>Posting the updated policy on our website</li>
                                <li>Updating the "Last Updated" date at the top of this policy</li>
                                <li>Sending an email notification to registered users (for significant changes)</li>
                            </ul>
                            <p>
                                Your continued use of our services after such modifications will constitute your 
                                acknowledgment of the modified Privacy Policy and agreement to be bound by it.
                            </p>
                        </div>
                    </section>

                    <section id="contact" className="privacy-section">
                        <div className="section-icon">✉️</div>
                        <div className="section-content">
                            <h2>9. Contact Us</h2>
                            <p>
                                If you have any questions, concerns, or requests regarding this Privacy Policy or 
                                our data practices, please contact us at:
                            </p>
                            <p>
                                <strong>Email:</strong> privacy@example.com<br />
                                <strong>Address:</strong> 123 Privacy Street, Data City, 10101
                            </p>
                            <p>
                                We are committed to working with you to obtain a fair resolution of any complaint 
                                or concern about privacy.
                            </p>
                        </div>
                    </section>
                </div>
            </div>

            <div className="privacy-footer">
                <p>This policy is effective as of the Last Updated date listed above.</p>
            </div>
        </div>
        <Footer />
    </>);
};

export default Privacy;