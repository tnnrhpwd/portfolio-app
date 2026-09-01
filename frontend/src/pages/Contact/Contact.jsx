import React from "react";
import { Link } from "react-router-dom";
import Footer from '../../components/Footer/Footer';
import Header from "../../components/Header/Header";
import SEO from "../../components/SEO/SEO.jsx";
import "./Contact.css";

const ADMIN_EMAIL = "Admin@STHopwood.com";
const PERSONAL_EMAIL = "Steven.T.Hopwood@gmail.com";

const CONTACT_METHODS = [
  { label: "Admin", value: ADMIN_EMAIL, href: `mailto:${ADMIN_EMAIL}`, note: "Support, bugs, and site issues" },
  { label: "Email", value: PERSONAL_EMAIL, href: `mailto:${PERSONAL_EMAIL}`, note: "Direct line to Steven" },
  { label: "LinkedIn", value: "linkedin.com/in/sthopwood", href: "https://www.linkedin.com/in/sthopwood/", note: "Professional network", external: true },
  { label: "GitHub", value: "github.com/tnnrhpwd", href: "https://github.com/tnnrhpwd", note: "Source code & open source", external: true },
  { label: "Résumé", value: "View my résumé", href: "https://docs.google.com/document/d/1l8yCRlom5hw-SwOfZtpria_AUuXwcXpC/edit?usp=sharing&ouid=106668374323360993837&rtpof=true&sd=true", note: "Experience & background", external: true },
];

// Insert word-break opportunities after dots, @, and slashes so long emails
// and URLs wrap at natural boundaries instead of mid-word.
const breakableValue = (value) =>
  value.split(/([.@/])/).map((part, i) =>
    part === "." || part === "@" || part === "/"
      ? <React.Fragment key={i}>{part}<wbr /></React.Fragment>
      : <React.Fragment key={i}>{part}</React.Fragment>
  );

function Contact() {
    return (
    <>
        <SEO
            title="Contact"
            description="Get in touch with Steven Tanner Hopwood — email, LinkedIn, GitHub, or send a message."
            path="/contact"
        />
        <Header />

        <div className="contact">
            <div className="contact-floating" aria-hidden="true">
                <div className="contact-circle contact-circle-1" />
                <div className="contact-circle contact-circle-2" />
                <div className="contact-circle contact-circle-3" />
            </div>

            {/* Hero */}
            <section className="contact-band contact-hero">
                <div className="contact-wrap">
                    <p className="contact-eyebrow">
                        <span className="contact-eyebrow-dot" aria-hidden="true" />
                        Contact
                    </p>
                    <h1 className="contact-title">Get in touch</h1>
                    <p className="contact-subtitle">
                        Questions, ideas, bugs, or just want to say hi — I'd love to hear from you.
                    </p>
                </div>
            </section>

            {/* Contact methods */}
            <section className="contact-band contact-band--surface">
                <div className="contact-wrap">
                    <div className="contact-section-head">
                        <p className="contact-eyebrow">Reach me</p>
                        <h2 className="contact-heading">Pick a channel</h2>
                        <p className="contact-lead">Email me directly, or connect on LinkedIn and GitHub.</p>
                    </div>
                    <div className="contact-methods">
                        {CONTACT_METHODS.map((method) => (
                            <a
                                key={method.label}
                                className="contact-method"
                                href={method.href}
                                target={method.external ? "_blank" : undefined}
                                rel={method.external ? "noopener noreferrer" : undefined}
                            >
                                <span className="contact-method-label">{method.label}</span>
                                <span className="contact-method-value">{breakableValue(method.value)}</span>
                                <span className="contact-method-note">{method.note}</span>
                                <span className="contact-method-arrow" aria-hidden="true">→</span>
                            </a>
                        ))}
                    </div>
                </div>
            </section>

            {/* Form */}
            <section className="contact-band contact-band--tint">
                <div className="contact-wrap">
                    <div className="contact-section-head">
                        <p className="contact-eyebrow">Message</p>
                        <h2 className="contact-heading">Send a note</h2>
                        <p className="contact-lead">Prefer a form? Drop a message below and I'll get back to you.</p>
                    </div>
                    <div className="contact-card">
                        <form name="contact" method="post" data-netlify="true" data-netlify-honeypot="bot-field">
                            <input type="hidden" name="form-name" value="contact" />
                            <div className="contact-field">
                                <label className="contact-label" htmlFor="contact-name">Name</label>
                                <input className="contact-input" id="contact-name" type="text" name="name" required />
                            </div>
                            <div className="contact-field">
                                <label className="contact-label" htmlFor="contact-email">Email (optional)</label>
                                <input className="contact-input" id="contact-email" type="email" name="email" />
                            </div>
                            <div className="contact-field">
                                <label className="contact-label" htmlFor="contact-message">Message</label>
                                <textarea className="contact-input contact-textarea" id="contact-message" name="message" rows="6" required></textarea>
                            </div>
                            <button className="contact-btn" type="submit">Send message <span aria-hidden="true">→</span></button>
                        </form>
                    </div>
                </div>
            </section>

            {/* Support cross-link */}
            <section className="contact-band contact-band--surface">
                <div className="contact-wrap">
                    <div className="contact-card contact-support-card">
                        <h2 className="contact-heading">Need help faster?</h2>
                        <p className="contact-lead">
                            The Support Center has FAQs, a bug reporter, and a quicker contact form.
                        </p>
                        <div className="contact-actions">
                            <Link className="contact-btn" to="/support">Go to Support <span aria-hidden="true">→</span></Link>
                        </div>
                    </div>
                </div>
            </section>

            <Footer />
        </div>
    </>);
}

export default Contact;
