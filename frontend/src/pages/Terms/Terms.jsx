import React, { useState } from 'react';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import SEO from '../../components/SEO/SEO.jsx';
import { PLAN_NAMES, PLAN_IDS, STORAGE_DISPLAY } from '../../constants/pricing';
import useScrollReveal from '../../hooks/useScrollReveal';
import '../legal/legal.css';

const Terms = () => {
    const [activeSection, setActiveSection] = useState("introduction");
    const [ref, visible] = useScrollReveal();

    const scrollToSection = (sectionId) => {
        setActiveSection(sectionId);
        document.getElementById(sectionId).scrollIntoView({ behavior: 'smooth' });
    };

    const currentDate = new Date();
    const currentMonth = currentDate.toLocaleString('default', { month: 'short' });
    const currentYear = currentDate.getFullYear();

    return (<>
        <SEO
            title="Terms of Service"
            description="Review STHopwood's terms of service, including membership plans, quotas, and usage policies."
            path="/terms"
        />
        <Header />
        <div className="terms">
            <div className="legal-floating" aria-hidden="true">
                <div className="legal-circle legal-circle-1" />
                <div className="legal-circle legal-circle-2" />
                <div className="legal-circle legal-circle-3" />
            </div>
            <div className='terms-header'>
                <span className="terms-eyebrow">STHopwood.com</span>
                <h1 className='terms-title'>Terms of Service</h1>
                <p className='terms-subtitle'>Last Updated: {currentMonth} {currentYear}</p>
            </div>

            <div ref={ref} className={`terms-container legal-reveal ${visible ? 'is-visible' : ''}`}>
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
                        <li className={activeSection === "credits" ? "active" : ""}>
                            <button onClick={() => scrollToSection("credits")}>4. AI Usage (Cloud Credits)</button>
                        </li>
                        <li className={activeSection === "payments" ? "active" : ""}>
                            <button onClick={() => scrollToSection("payments")}>5. Payments & Billing</button>
                        </li>
                        <li className={activeSection === "fairuse" ? "active" : ""}>
                            <button onClick={() => scrollToSection("fairuse")}>6. Fair Use & Rate Limits</button>
                        </li>
                        <li className={activeSection === "privacy" ? "active" : ""}>
                            <button onClick={() => scrollToSection("privacy")}>7. Privacy & Data</button>
                        </li>
                        <li className={activeSection === "conduct" ? "active" : ""}>
                            <button onClick={() => scrollToSection("conduct")}>8. User Conduct</button>
                        </li>
                        <li className={activeSection === "intellectual" ? "active" : ""}>
                            <button onClick={() => scrollToSection("intellectual")}>9. Intellectual Property</button>
                        </li>
                        <li className={activeSection === "termination" ? "active" : ""}>
                            <button onClick={() => scrollToSection("termination")}>10. Termination</button>
                        </li>
                        <li className={activeSection === "disclaimer" ? "active" : ""}>
                            <button onClick={() => scrollToSection("disclaimer")}>11. Disclaimers & Limitations</button>
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
                                Our platform offers two subscription tiers — {PLAN_NAMES[PLAN_IDS.FREE]} and {PLAN_NAMES[PLAN_IDS.PRO]}. 
                                Each plan provides different levels of access, usage limits, and features as described 
                                below and on our pricing page. All prices are in USD.
                            </p>
                            <h3>3.1 {PLAN_NAMES[PLAN_IDS.FREE]} Tier — $0/month</h3>
                            <p>
                                Our {PLAN_NAMES[PLAN_IDS.FREE]} tier provides limited access for evaluation and personal use:
                            </p>
                            <ul>
                                <li>/net AI chat with included monthly cloud credits (see §4)</li>
                                <li>Simple desktop addon — full local automation, no daily cap</li>
                                <li>{STORAGE_DISPLAY[PLAN_IDS.FREE]} cloud storage</li>
                            </ul>
                            <p>
                                The /net AI chat feature is included on the Free tier with a monthly cloud-credit
                                allowance; usage beyond that allowance is unavailable until the next monthly cycle
                                (see §4).
                            </p>
                            <h3>3.2 {PLAN_NAMES[PLAN_IDS.PRO]} Membership — $15/month</h3>
                            <p>
                                The {PLAN_NAMES[PLAN_IDS.PRO]} tier is billed at <strong>$15.00 USD per month</strong> and includes:
                            </p>
                            <ul>
                                <li>Everything in {PLAN_NAMES[PLAN_IDS.FREE]}</li>
                                <li>Live screen viewing from your phone</li>
                                <li>{STORAGE_DISPLAY[PLAN_IDS.PRO]} cloud storage</li>
                                <li>Email support</li>
                            </ul>
                            <p>
                                AI usage on all plans is metered against an included monthly cloud-credit allowance
                                (see §4). There is no bring-your-own-key option.
                            </p>
                            <h3>3.3 Pricing Changes</h3>
                            <p>
                                We reserve the right to modify subscription pricing at any time. You will receive 
                                at least 30 days' notice before any price increase takes effect. Continued use of
                                the service after the new pricing takes effect constitutes acceptance of the updated prices.
                            </p>
                        </div>
                    </section>

                    <section id="credits" className="terms-section">
                        <div className="section-icon">⚡</div>
                        <div className="section-content">
                            <h2>4. AI Usage (Cloud Credits)</h2>
                            <h3>4.1 Metered Cloud AI</h3>
                            <p>
                                AI features on our platform are provided by us and metered against a monthly
                                cloud-credit allowance included with each plan. There is no bring-your-own-key
                                (BYOK) option — you do not supply, and we do not accept, third-party API keys.
                            </p>
                            <h3>4.2 Monthly Allowances</h3>
                            <p>
                                The Free tier includes a $0.50 monthly credit allowance and the Pro tier includes a
                                $10.00 monthly credit allowance. Usage is measured against the cost of each request;
                                when your allowance for the current cycle is exhausted, further AI requests are
                                paused until the next monthly cycle.
                            </p>
                            <h3>4.3 Fair Use</h3>
                            <p>
                                Allowances are provided as part of your subscription and are subject to our fair-use
                                policy (§6). We may adjust allowance amounts with reasonable notice as described in
                                §3.3.
                            </p>
                        </div>
                    </section>

                    <section id="payments" className="terms-section">
                        <div className="section-icon">💳</div>
                        <div className="section-content">
                            <h2>5. Payments & Billing</h2>
                            <h3>5.1 Payment Processing</h3>
                            <p>
                                All payments are processed securely through Stripe. By providing your payment 
                                information, you authorize us to charge your payment method for recurring
                                subscription fees and any applicable usage-based charges.
                            </p>
                            <h3>5.2 Recurring Billing</h3>
                            <p>
                                Paid subscriptions are billed monthly on the anniversary of your sign-up date.
                                You will be charged automatically unless you cancel before your next billing date.
                            </p>
                            <h3>5.3 Failed Payments</h3>
                            <p>
                                If a payment fails, we may retry the charge and/or suspend your access to paid
                                features until the outstanding balance is settled. An account with an unpaid balance
                                for more than 30 days may be downgraded to the {PLAN_NAMES[PLAN_IDS.FREE]} tier automatically.
                            </p>
                            <h3>5.4 Refund Policy</h3>
                            <p>
                                Subscription fees are <strong>non-refundable</strong> once a billing cycle has begun,
                                except where required by applicable law. Cancelling (switching to {PLAN_NAMES[PLAN_IDS.FREE]})
                                takes effect <strong>immediately</strong> — your Pro features stop right away and you will
                                not be charged again, but you will not receive a refund or credit for the unused portion
                                of the current billing period. We may grant discretionary refunds on a case-by-case
                                basis within 7 days of an initial subscription purchase.
                            </p>
                            <h3>5.5 Plan Upgrades & Downgrades</h3>
                            <p>
                                You may upgrade your plan at any time; the new rate takes effect immediately and
                                any price difference is prorated for the remainder of the current billing period.
                                Downgrading from {PLAN_NAMES[PLAN_IDS.PRO]} to {PLAN_NAMES[PLAN_IDS.FREE]} also takes effect
                                immediately, per the Refund Policy above.
                            </p>
                        </div>
                    </section>

                    <section id="fairuse" className="terms-section">
                        <div className="section-icon">📏</div>
                        <div className="section-content">
                            <h2>6. Fair Use & Rate Limits</h2>
                            <h3>6.1 Purpose</h3>
                            <p>
                                To maintain quality of service for all users and to protect the sustainability of
                                our platform, all plans are subject to a fair-use policy and defined storage limits.
                            </p>
                            <h3>6.2 Addon Command Limits</h3>
                            <p>
                                The Simple desktop addon runs entirely on your own PC, so automation commands are
                                <strong> unlimited on every tier</strong> — {PLAN_NAMES[PLAN_IDS.FREE]} and {PLAN_NAMES[PLAN_IDS.PRO]} alike, subject to
                                fair use. Automated, scripted, or bulk usage that abuses this fair-use policy may
                                result in throttling or suspension.
                            </p>
                            <h3>6.3 Storage Limits</h3>
                            <ul>
                                <li><strong>{PLAN_NAMES[PLAN_IDS.FREE]}:</strong> {STORAGE_DISPLAY[PLAN_IDS.FREE]}</li>
                                <li><strong>{PLAN_NAMES[PLAN_IDS.PRO]}:</strong> {STORAGE_DISPLAY[PLAN_IDS.PRO]}. Additional storage
                                    may be available upon request and may incur additional fees.</li>
                            </ul>
                            <h3>6.4 Rate Limiting</h3>
                            <p>
                                API endpoints are rate-limited to prevent abuse. If you exceed rate limits, requests 
                                may be temporarily throttled or rejected. Persistent abuse of rate limits may result 
                                in account suspension.
                            </p>
                            <h3>6.5 Prohibited Use</h3>
                            <p>
                                You may not resell, redistribute, or sublicense access to our services. Accounts used
                                primarily as shared or multi-user proxies, or that generate usage patterns consistent
                                with automated scraping, will be subject to immediate suspension.
                            </p>
                        </div>
                    </section>

                    <section id="privacy" className="terms-section">
                        <div className="section-icon">🔒</div>
                        <div className="section-content">
                            <h2>7. Privacy & Data</h2>
                            <p>
                                Your use of our services is governed by our Privacy Policy, which describes how we 
                                collect, use, and protect your information. By using our services, you consent to 
                                the collection and processing of your information as described in our Privacy Policy.
                            </p>
                            <p>
                                We implement security measures designed to protect your data, including secure payment 
                                processing through bank-level encryption. However, no method of electronic storage 
                                or transmission is 100% secure, and we cannot guarantee absolute security.
                            </p>
                        </div>
                    </section>

                    <section id="conduct" className="terms-section">
                        <div className="section-icon">⚖️</div>
                        <div className="section-content">
                            <h2>8. User Conduct</h2>
                            <p>
                                You agree to use our services for lawful purposes and in accordance with these terms. 
                                You are prohibited from:
                            </p>
                            <ul>
                                <li>Using our services for any illegal purpose</li>
                                <li>Attempting to interfere with, compromise, or disrupt our services</li>
                                <li>Circumventing usage limits, quotas, or rate limits</li>
                                <li>Sharing your account credentials with others or operating shared accounts</li>
                                <li>Reverse engineering or attempting to extract our source code</li>
                                <li>Using the platform to generate content that violates any third-party AI provider's acceptable-use policy</li>
                                <li>Reselling, sub-licensing, or redistributing platform access or output</li>
                            </ul>
                        </div>
                    </section>

                    <section id="intellectual" className="terms-section">
                        <div className="section-icon">©</div>
                        <div className="section-content">
                            <h2>9. Intellectual Property</h2>
                            <p>
                                All content provided on our platform, including text, graphics, logos, button icons, 
                                images, audio clips, digital downloads, data compilations, and software, is the 
                                property of our company or its content suppliers and is protected by international 
                                copyright laws.
                            </p>
                            <p>
                                We grant you a limited, non-exclusive, non-transferable license to use our services 
                                in accordance with these Terms for personal, non-commercial use. This license does 
                                not include any resale or commercial redistribution of our services or content.
                            </p>
                            <p>
                                Content you create or upload through our platform remains yours. By uploading content,
                                you grant us a limited license to store, process, and display it solely to provide 
                                the service to you.
                            </p>
                        </div>
                    </section>

                    <section id="termination" className="terms-section">
                        <div className="section-icon">🚫</div>
                        <div className="section-content">
                            <h2>10. Termination</h2>
                            <h3>10.1 By Us</h3>
                            <p>
                                We reserve the right to terminate or suspend your account and access to our services 
                                at any time, with or without cause, including but not limited to violation of these
                                Terms, the Fair Use policy, or non-payment. Upon termination, your right to use 
                                our services will immediately cease.
                            </p>
                            <h3>10.2 By You</h3>
                            <p>
                                You may cancel your subscription at any time through your account settings.
                                Cancellation will take effect at the end of your current billing cycle — you will
                                retain access to paid features for the remainder of the period you have already paid for,
                                but you will not be charged again.
                            </p>
                            <h3>10.3 Effect of Termination</h3>
                            <p>
                                Upon termination or downgrade to the {PLAN_NAMES[PLAN_IDS.FREE]} tier, data stored in
                                excess of the Free tier's {STORAGE_DISPLAY[PLAN_IDS.FREE]} limit may be scheduled for
                                deletion after a 30-day grace period. We recommend exporting any data you wish to
                                keep before cancelling.
                            </p>
                        </div>
                    </section>

                    <section id="disclaimer" className="terms-section">
                        <div className="section-icon">⚠️</div>
                        <div className="section-content">
                            <h2>11. Disclaimers & Limitations</h2>
                            <h3>11.1 "As Is" Basis</h3>
                            <p>
                                Our services are provided on an "as is" and "as available" basis. We make no 
                                warranties, expressed or implied, regarding the reliability, accuracy, availability, 
                                or performance of our services.
                            </p>
                            <h3>11.2 Third-Party Services</h3>
                            <p>
                                Our platform relies on third-party services including, but not limited to, AI model
                                providers (Anthropic, DeepSeek, etc.), cloud infrastructure (AWS), and payment processing
                                (Stripe). We are not responsible for outages, changes, or discontinuations of these
                                third-party services. Changes in third-party pricing may be reflected in our cost tables.
                            </p>
                            <h3>11.3 Limitation of Liability</h3>
                            <p>
                                To the fullest extent permitted by law, we disclaim all warranties, including but 
                                not limited to merchantability, fitness for a particular purpose, and non-infringement.
                                In no event shall our total liability exceed the amount you paid for the service in 
                                the 3-month period immediately preceding the event giving rise to the claim.
                            </p>
                            <h3>11.4 AI Output</h3>
                            <p>
                                AI-generated content is provided for informational purposes only and may contain
                                inaccuracies. You are solely responsible for reviewing, verifying, and any reliance
                                on AI-generated output. We disclaim all liability for actions taken based on
                                AI-generated content.
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