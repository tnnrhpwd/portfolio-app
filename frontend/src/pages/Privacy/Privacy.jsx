import React, { useState } from 'react';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import './Privacy.css';

const NAV_ITEMS = [
    { id: 'introduction', label: 'Introduction', icon: '👋' },
    { id: 'collection', label: '1. Information We Collect', icon: '📋' },
    { id: 'usage', label: '2. How We Use Your Information', icon: '🔍' },
    { id: 'ai', label: '3. AI Features & Third Parties', icon: '🤖' },
    { id: 'payment', label: '4. Payment Processing', icon: '💳' },
    { id: 'security', label: '5. Data Storage & Security', icon: '🔒' },
    { id: 'sharing', label: '6. Information Sharing', icon: '🤝' },
    { id: 'cookies', label: '7. Cookies & Tracking', icon: '🍪' },
    { id: 'retention', label: '8. Data Retention & Deletion', icon: '🗄️' },
    { id: 'rights', label: '9. Your Privacy Rights', icon: '⚖️' },
    { id: 'children', label: "10. Children's Privacy", icon: '👶' },
    { id: 'updates', label: '11. Policy Updates', icon: '🔄' },
    { id: 'contact', label: '12. Contact Us', icon: '✉️' },
];

const Privacy = () => {
    const [activeSection, setActiveSection] = useState('introduction');

    const scrollToSection = (sectionId) => {
        setActiveSection(sectionId);
        const el = document.getElementById(sectionId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const currentDate = new Date();
    const currentMonth = currentDate.toLocaleString('default', { month: 'long' });
    const currentYear = currentDate.getFullYear();

    return (<>
        <Header />
        <div className="privacy">
            <div className="privacy-header">
                <span className="privacy-eyebrow">STHopwood.com</span>
                <h1 className="privacy-title">Privacy Policy</h1>
                <p className="privacy-subtitle">Last Updated: {currentMonth} {currentYear}</p>
                <div className="privacy-badges">
                    <span className="privacy-badge badge-orange">🔐 Data encrypted in transit</span>
                    <span className="privacy-badge badge-blue">🚫 We never sell your data</span>
                    <span className="privacy-badge badge-mint">🧾 Payments handled by Stripe</span>
                </div>
            </div>

            <div className="privacy-container">
                <div className="privacy-navigation">
                    <h3>Contents</h3>
                    <ul>
                        {NAV_ITEMS.map((item) => (
                            <li key={item.id} className={activeSection === item.id ? 'active' : ''}>
                                <button onClick={() => scrollToSection(item.id)}>
                                    <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                                    {item.label}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="privacy-content">
                    <section id="introduction" className="privacy-section">
                        <div className="section-icon">👋</div>
                        <div className="section-content">
                            <div className="tldr-box">
                                <h4>The short version</h4>
                                <p>
                                    STHopwood.com is a personal software platform built and operated by Steven T.
                                    Hopwood. It lets you create an account, save your own content ("Data" entries such
                                    as notes, plans, and actions), optionally use AI-assisted and file-processing
                                    features, and subscribe to paid plans through Stripe. This policy explains exactly
                                    what we collect, why, and the choices you have.
                                </p>
                            </div>
                            <p>
                                We respect your privacy and are committed to protecting your personal information.
                                This Privacy Policy explains how we collect, use, disclose, and safeguard your
                                information when you use our website and services (the "Service"), including account
                                registration, data storage, AI-assisted tools, file uploads, the marketplace, and
                                payment processing.
                            </p>
                            <p>
                                By accessing or using the Service, you agree to the collection and use of information
                                in accordance with this policy. If you do not agree with our policies and practices,
                                please do not use the Service.
                            </p>
                        </div>
                    </section>

                    <section id="collection" className="privacy-section">
                        <div className="section-icon">📋</div>
                        <div className="section-content">
                            <h2>1. Information We Collect</h2>

                            <h3>1.1 Account Information</h3>
                            <p>When you register for an account (including as a guest user), we collect:</p>
                            <ul>
                                <li>Nickname / display name and email address</li>
                                <li>A securely hashed password (we never store passwords in plain text)</li>
                                <li>Account creation date and subscription/plan status</li>
                            </ul>

                            <h3>1.2 Content You Create</h3>
                            <p>
                                Our Service lets you create, edit, and store your own content &mdash; such as notes,
                                plans, actions, workspace items, and marketplace listings ("Data"). This content is
                                stored in our database so it is available to you (and, where you choose to share it,
                                to other users) whenever you sign in.
                            </p>

                            <h3>1.3 Files &amp; Uploads</h3>
                            <p>
                                If you use features that accept file or image uploads (for example, document/image
                                text extraction), we store the uploaded files in secure cloud storage and any
                                extracted text or metadata associated with them.
                            </p>

                            <h3>1.4 Usage &amp; Device Information</h3>
                            <p>
                                When you access our services, we automatically collect certain information about your
                                device and usage patterns, including:
                            </p>
                            <ul>
                                <li>IP address and device/browser identifiers</li>
                                <li>Browser type and operating system</li>
                                <li>Pages viewed, features used, and referring links</li>
                                <li>Timestamps of activity and session length</li>
                                <li>API request volumes and patterns (used for rate limiting and abuse prevention)</li>
                            </ul>

                            <h3>1.5 Payment Information</h3>
                            <p>
                                When you subscribe to a paid plan, our payment processor, Stripe, collects
                                payment-related information necessary to process your transaction, such as your
                                payment method, billing address, and transaction history. See Section 4 for details.
                            </p>
                        </div>
                    </section>

                    <section id="usage" className="privacy-section">
                        <div className="section-icon">🔍</div>
                        <div className="section-content">
                            <h2>2. How We Use Your Information</h2>
                            <p>We use the information we collect for purposes including:</p>
                            <ul>
                                <li>
                                    <strong>Providing the Service:</strong> To operate, maintain, secure, and improve
                                    the platform and the features you use.
                                </li>
                                <li>
                                    <strong>Storing your content:</strong> To save and retrieve the Data you create so
                                    it's available across sessions and devices.
                                </li>
                                <li>
                                    <strong>Personalization:</strong> To remember your preferences and tailor the
                                    experience to how you use the Service.
                                </li>
                                <li>
                                    <strong>Communication:</strong> To respond to your inquiries, send account or
                                    billing notifications, and provide customer support.
                                </li>
                                <li>
                                    <strong>Subscription management:</strong> To process transactions, manage your
                                    subscription, and enforce plan usage limits (e.g. storage or request quotas).
                                </li>
                                <li>
                                    <strong>Analytics &amp; improvement:</strong> To understand how users interact
                                    with the platform and to prioritize fixes and new features.
                                </li>
                                <li>
                                    <strong>Security:</strong> To detect and prevent fraud, abuse, unauthorized access,
                                    and other security issues (including rate limiting and request monitoring).
                                </li>
                            </ul>
                        </div>
                    </section>

                    <section id="ai" className="privacy-section">
                        <div className="section-icon">🤖</div>
                        <div className="section-content">
                            <h2>3. AI Features &amp; Third-Party Processing</h2>
                            <p>
                                Some features of the Service use artificial intelligence to process content you
                                submit &mdash; for example, generating suggestions, summarizing text, or extracting
                                text from uploaded images and documents (OCR). To provide these features, the text or
                                files you submit for that purpose may be sent to third-party AI providers, which may
                                include OpenAI, xAI, and GitHub Models, for processing.
                            </p>
                            <ul>
                                <li>Only the content necessary to complete your request is sent to these providers.</li>
                                <li>
                                    These providers process the data under their own privacy and data-handling terms;
                                    we do not control how long they retain data on their systems.
                                </li>
                                <li>
                                    We do not use your content to train our own models, and we take reasonable steps to
                                    select providers with strong data-protection commitments.
                                </li>
                                <li>
                                    AI-assisted features are optional &mdash; if you prefer not to have content sent
                                    to a third-party AI provider, avoid using those specific features.
                                </li>
                            </ul>
                        </div>
                    </section>

                    <section id="payment" className="privacy-section">
                        <div className="section-icon">💳</div>
                        <div className="section-content">
                            <h2>4. Payment Processing</h2>
                            <p>
                                We use <strong>Stripe</strong>, a PCI-compliant third-party payment processor, to
                                securely handle all payment transactions on our platform. When you provide payment
                                information:
                            </p>
                            <ul>
                                <li>
                                    Your payment details are encrypted and transmitted directly to Stripe using
                                    industry-standard (TLS) encryption. They do not pass through our servers.
                                </li>
                                <li>
                                    We do not store your full card number or CVV. We retain a Stripe customer/token
                                    identifier so we can process renewals and let you manage your subscription.
                                </li>
                                <li>
                                    Billing history and subscription status are retained for accounting, tax, and
                                    dispute-resolution purposes as required by applicable regulations.
                                </li>
                            </ul>
                            <p>
                                Stripe's handling of your payment information is governed by Stripe's own{' '}
                                <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">
                                    privacy policy
                                </a>. We encourage you to review it.
                            </p>
                        </div>
                    </section>

                    <section id="security" className="privacy-section">
                        <div className="section-icon">🔒</div>
                        <div className="section-content">
                            <h2>5. Data Storage &amp; Security</h2>
                            <p>
                                Your account data and Data entries are stored using Amazon Web Services (AWS),
                                including DynamoDB for structured data and Amazon S3 for uploaded files. We implement
                                technical and organizational measures to protect your information, including:
                            </p>
                            <ul>
                                <li>Encryption of sensitive data in transit (HTTPS/TLS) and hashed storage of passwords</li>
                                <li>Authentication tokens (JWT) with expiration, used to keep you securely signed in</li>
                                <li>Rate limiting and request validation to guard against brute-force and abuse</li>
                                <li>Security headers (via Helmet.js) and input sanitization to reduce XSS/injection risk</li>
                                <li>Automated dependency and vulnerability scanning (Dependabot, CodeQL)</li>
                                <li>Access controls limiting who can reach production data</li>
                            </ul>
                            <p>
                                While we work hard to protect your information, no method of transmission over the
                                internet or electronic storage is 100% secure, and we cannot guarantee absolute
                                security.
                            </p>
                        </div>
                    </section>

                    <section id="sharing" className="privacy-section">
                        <div className="section-icon">🤝</div>
                        <div className="section-content">
                            <h2>6. Information Sharing</h2>
                            <p>
                                We do not sell, rent, or trade your personal information. We only share information in
                                the following limited circumstances:
                            </p>
                            <ul>
                                <li>
                                    <strong>Service providers:</strong> Trusted third parties who help us operate the
                                    Service, such as Stripe (payments), AWS (hosting and storage), and AI providers
                                    used for the optional features described in Section 3.
                                </li>
                                <li>
                                    <strong>Marketplace &amp; sharing features:</strong> If you choose to publish
                                    content to the marketplace or share it with other users, that content (and
                                    associated public profile details, such as your nickname) becomes visible to those
                                    users or the public, as applicable.
                                </li>
                                <li>
                                    <strong>Legal requirements:</strong> When required by law, subpoena, or court
                                    order, or when we believe in good faith that disclosure is necessary to protect our
                                    rights, your safety, or the safety of others.
                                </li>
                                <li>
                                    <strong>Business transfers:</strong> In connection with a merger, acquisition, or
                                    sale of assets, information may be transferred as part of that transaction.
                                </li>
                                <li>
                                    <strong>With your consent:</strong> Whenever you explicitly agree to a specific
                                    disclosure.
                                </li>
                            </ul>
                            <p>
                                We require third parties that process data on our behalf to protect it in accordance
                                with applicable law and to use it only for the purposes we specify.
                            </p>
                        </div>
                    </section>

                    <section id="cookies" className="privacy-section">
                        <div className="section-icon">🍪</div>
                        <div className="section-content">
                            <h2>7. Cookies &amp; Tracking</h2>
                            <p>
                                We use a small number of cookies and similar technologies (such as browser local
                                storage) that are essential to running the Service:
                            </p>
                            <ul>
                                <li><strong>Authentication:</strong> to keep you securely signed in between visits.</li>
                                <li><strong>Preferences:</strong> to remember settings like your selected theme.</li>
                                <li>
                                    <strong>Referral &amp; usage analytics:</strong> to understand which pages and
                                    referral sources are used, so we can improve the Service.
                                </li>
                            </ul>
                            <p>
                                We do not currently use third-party advertising cookies or cross-site ad trackers. You
                                can control or delete cookies through your browser settings; note that blocking
                                essential cookies may prevent you from staying signed in or using payment features.
                            </p>
                        </div>
                    </section>

                    <section id="retention" className="privacy-section">
                        <div className="section-icon">🗄️</div>
                        <div className="section-content">
                            <h2>8. Data Retention &amp; Deletion</h2>
                            <p>
                                We retain your account information and Data entries for as long as your account is
                                active, or as needed to provide the Service to you. If you delete a Data entry or your
                                account, we remove it from our active systems; residual copies may briefly persist in
                                backups before being purged on a rolling schedule.
                            </p>
                            <ul>
                                <li>Billing and transaction records may be retained longer where required for legal, tax, or accounting purposes.</li>
                                <li>Security logs (e.g. for abuse prevention) are retained for a limited period and then deleted or anonymized.</li>
                                <li>You may request deletion of your account and associated Data at any time &mdash; see Section 9.</li>
                            </ul>
                        </div>
                    </section>

                    <section id="rights" className="privacy-section">
                        <div className="section-icon">⚖️</div>
                        <div className="section-content">
                            <h2>9. Your Privacy Rights</h2>
                            <p>
                                Depending on your location (for example, under the GDPR or CCPA), you may have rights
                                regarding your personal information, including the right to:
                            </p>
                            <ul>
                                <li><strong>Access:</strong> Request a copy of the personal information we hold about you.</li>
                                <li><strong>Correction:</strong> Ask us to update or correct inaccurate data.</li>
                                <li><strong>Deletion:</strong> Request that we delete your account and personal information.</li>
                                <li><strong>Restriction:</strong> Ask us to limit how we use your data.</li>
                                <li><strong>Data portability:</strong> Request a copy of your data in a structured, commonly used format.</li>
                                <li><strong>Objection:</strong> Object to certain processing of your data.</li>
                            </ul>
                            <p>
                                To exercise any of these rights, contact us at{' '}
                                <a href="mailto:Admin@STHopwood.com">Admin@STHopwood.com</a>. We will respond within
                                the timeframe required by applicable law, and may need to verify your identity before
                                completing certain requests.
                            </p>
                        </div>
                    </section>

                    <section id="children" className="privacy-section">
                        <div className="section-icon">👶</div>
                        <div className="section-content">
                            <h2>10. Children's Privacy</h2>
                            <p>
                                The Service is not directed to children under 13, and we do not knowingly collect
                                personal information from children under 13. If you believe a child has provided us
                                with personal information, please contact us at{' '}
                                <a href="mailto:Admin@STHopwood.com">Admin@STHopwood.com</a> so we can promptly remove
                                it.
                            </p>
                        </div>
                    </section>

                    <section id="updates" className="privacy-section">
                        <div className="section-icon">🔄</div>
                        <div className="section-content">
                            <h2>11. Policy Updates</h2>
                            <p>
                                We may update this Privacy Policy from time to time to reflect changes in our
                                practices, features, or applicable law. We will notify you of material changes by:
                            </p>
                            <ul>
                                <li>Posting the updated policy on this page</li>
                                <li>Updating the "Last Updated" date at the top of this policy</li>
                                <li>Where appropriate, notifying registered users of significant changes</li>
                            </ul>
                            <p>
                                Your continued use of the Service after changes take effect constitutes your
                                acknowledgment of the updated Privacy Policy.
                            </p>
                        </div>
                    </section>

                    <section id="contact" className="privacy-section">
                        <div className="section-icon">✉️</div>
                        <div className="section-content">
                            <h2>12. Contact Us</h2>
                            <p>
                                If you have any questions, concerns, or requests regarding this Privacy Policy or our
                                data practices, please reach out:
                            </p>
                            <p className="contact-details">
                                <strong>Email:</strong>{' '}
                                <a href="mailto:Admin@STHopwood.com">Admin@STHopwood.com</a><br />
                                <strong>Website:</strong>{' '}
                                <a href="https://www.sthopwood.com" target="_blank" rel="noopener noreferrer">
                                    www.sthopwood.com
                                </a>
                            </p>
                            <p>
                                We're committed to working with you to reach a fair resolution of any privacy question
                                or concern.
                            </p>
                        </div>
                    </section>
                </div>
            </div>

            <div className="privacy-footer">
                <p>This policy is effective as of the Last Updated date listed above.</p>
                <button className="back-to-top" onClick={scrollToTop}>↑ Back to top</button>
            </div>
        </div>
        <Footer />
    </>);
};

export default Privacy;
