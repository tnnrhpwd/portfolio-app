import React, { useState } from 'react';
import Header from '../../components/Header/Header';
import Footer from '../../components/Footer/Footer';
import { PLAN_NAMES, PLAN_IDS, QUOTAS, STORAGE_DISPLAY, CREDITS } from '../../constants/pricing';
import './Terms.css';

const Terms = () => {
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
        <div className="terms">
            <div className='terms-header'>
                <h1 className='terms-title'>Terms of Service</h1>
                <p className='terms-subtitle'>Last Updated: {currentMonth} {currentYear}</p>
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
                        <li className={activeSection === "credits" ? "active" : ""}>
                            <button onClick={() => scrollToSection("credits")}>4. AI Credits & Usage</button>
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
                                Our platform offers three subscription tiers — {PLAN_NAMES[PLAN_IDS.FREE]}, {PLAN_NAMES[PLAN_IDS.PRO]}, and {PLAN_NAMES[PLAN_IDS.SIMPLE]}. 
                                Each plan provides different levels of access, usage limits, and features as described 
                                below and on our pricing page. All prices are in USD.
                            </p>
                            <h3>3.1 {PLAN_NAMES[PLAN_IDS.FREE]} Tier — $0/month</h3>
                            <p>
                                Our {PLAN_NAMES[PLAN_IDS.FREE]} tier provides limited access for evaluation and personal use:
                            </p>
                            <ul>
                                <li>/net AI chat with your own API key (bring-your-own-key only; no included AI credits)</li>
                                <li>CSimple desktop addon — 14-day free trial</li>
                                <li>{QUOTAS[PLAN_IDS.FREE]} addon usage</li>
                                <li>{STORAGE_DISPLAY[PLAN_IDS.FREE]} cloud storage</li>
                            </ul>
                            <p>
                                After the 14-day trial the addon will require a paid subscription. The /net AI chat
                                feature remains available on the Free tier with your own API key at no charge from us.
                            </p>
                            <h3>3.2 {PLAN_NAMES[PLAN_IDS.PRO]} Membership — $12/month</h3>
                            <p>
                                The {PLAN_NAMES[PLAN_IDS.PRO]} tier is billed at <strong>$12.00 USD per month</strong> and includes:
                            </p>
                            <ul>
                                <li>Everything in {PLAN_NAMES[PLAN_IDS.FREE]}</li>
                                <li>{CREDITS[PLAN_IDS.PRO].display} of included monthly AI credits for /net chat</li>
                                <li>{QUOTAS[PLAN_IDS.PRO]}</li>
                                <li>{STORAGE_DISPLAY[PLAN_IDS.PRO]} cloud storage</li>
                                <li>Full analytics dashboard</li>
                                <li>Email support</li>
                            </ul>
                            <p>
                                When the monthly AI credit allowance is exhausted, AI-powered features will be
                                paused until the next billing cycle or until you upgrade to {PLAN_NAMES[PLAN_IDS.SIMPLE]}.
                                Unused credits do not roll over.
                            </p>
                            <h3>3.3 {PLAN_NAMES[PLAN_IDS.SIMPLE]} Membership — $39/month</h3>
                            <p>
                                The {PLAN_NAMES[PLAN_IDS.SIMPLE]} tier is billed at <strong>$39.00 USD per month</strong> and includes:
                            </p>
                            <ul>
                                <li>Everything in {PLAN_NAMES[PLAN_IDS.PRO]}</li>
                                <li>Custom AI credit limit (default {CREDITS[PLAN_IDS.SIMPLE].display}/month, adjustable)</li>
                                <li>5,000 addon commands per day</li>
                                <li>Phone-to-PC remote control</li>
                                <li>{STORAGE_DISPLAY[PLAN_IDS.SIMPLE]} cloud storage</li>
                                <li>Priority support</li>
                            </ul>
                            <p>
                                All usage limits are hard caps. Custom credit limits may be adjusted by you
                                at any time; charges for API usage beyond the base subscription are calculated
                                at the end of each billing period.
                            </p>
                            <h3>3.4 Pricing Changes</h3>
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
                            <h2>4. AI Credits & Usage</h2>
                            <h3>4.1 AI Credit System</h3>
                            <p>
                                Paid plans include a monthly allowance of AI credits that cover the cost of third-party
                                AI model calls (e.g., OpenAI, Anthropic) made through our /net chat and addon features.
                                Credits are denominated in US dollars and are deducted based on the actual cost of
                                each API call at our then-current rates.
                            </p>
                            <h3>4.2 Credit Limits</h3>
                            <ul>
                                <li><strong>{PLAN_NAMES[PLAN_IDS.FREE]}:</strong> No included credits — bring your own API key.</li>
                                <li><strong>{PLAN_NAMES[PLAN_IDS.PRO]}:</strong> {CREDITS[PLAN_IDS.PRO].display} per month. When exhausted, AI features pause until the next cycle.</li>
                                <li><strong>{PLAN_NAMES[PLAN_IDS.SIMPLE]}:</strong> Customizable limit (default {CREDITS[PLAN_IDS.SIMPLE].display}/month). Usage beyond the custom limit will pause AI features until the next cycle or until you raise the limit.</li>
                            </ul>
                            <h3>4.3 No Rollover</h3>
                            <p>
                                Unused AI credits expire at the end of each monthly billing period and do not
                                accumulate or roll over to subsequent months.
                            </p>
                            <h3>4.4 Rate Transparency</h3>
                            <p>
                                Per-call AI costs are determined by third-party provider pricing and may change
                                without notice. Updated cost tables are available within the platform. We do not 
                                mark up third-party API costs passed through to your credit balance.
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
                                except where required by applicable law. If you cancel mid-cycle, you will retain 
                                access to paid features until the end of your current billing period but will not
                                receive a prorated refund. We may grant discretionary refunds on a case-by-case
                                basis within 7 days of an initial subscription purchase.
                            </p>
                            <h3>5.5 Plan Upgrades & Downgrades</h3>
                            <p>
                                You may upgrade your plan at any time; the new rate takes effect immediately and
                                any price difference is prorated for the remainder of the current billing period.
                                Downgrades take effect at the start of the next billing cycle.
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
                                our platform, all plans are subject to defined usage caps and a fair-use policy.
                            </p>
                            <h3>6.2 Addon Command Limits</h3>
                            <ul>
                                <li><strong>{PLAN_NAMES[PLAN_IDS.FREE]}:</strong> {QUOTAS[PLAN_IDS.FREE]}</li>
                                <li><strong>{PLAN_NAMES[PLAN_IDS.PRO]}:</strong> {QUOTAS[PLAN_IDS.PRO]}</li>
                                <li><strong>{PLAN_NAMES[PLAN_IDS.SIMPLE]}:</strong> {QUOTAS[PLAN_IDS.SIMPLE]}. Automated, scripted, or
                                    bulk usage that circumvents these limits may result in throttling or suspension.</li>
                            </ul>
                            <h3>6.3 Storage Limits</h3>
                            <ul>
                                <li><strong>{PLAN_NAMES[PLAN_IDS.FREE]}:</strong> {STORAGE_DISPLAY[PLAN_IDS.FREE]}</li>
                                <li><strong>{PLAN_NAMES[PLAN_IDS.PRO]}:</strong> {STORAGE_DISPLAY[PLAN_IDS.PRO]}</li>
                                <li><strong>{PLAN_NAMES[PLAN_IDS.SIMPLE]}:</strong> {STORAGE_DISPLAY[PLAN_IDS.SIMPLE]}. Additional storage
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
                                providers (OpenAI, Anthropic, etc.), cloud infrastructure (AWS), and payment processing
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