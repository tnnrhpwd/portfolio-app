import React, { useState } from 'react';
import Header from './../../../components/Header/Header';
import './Simple.css';
import Footer from './../../../components/Footer/Footer';
import simpleGraphic from './simple_graphic.png';

const simplelink = "https://github.com/tnnrhpwd/C-Simple";

function Simple() {
  const [selectedPlan, setSelectedPlan] = useState('pro');

  return (
    <>
      <Header />
      <div className='planit-dashboard'>
        <div className='planit-dashboard-upper'>
          <div className='early-access-badge'>
            � Early Access - Limited Time Beta Pricing
          </div>
          <header className='planit-dashboard-upper-header'>
            Stop Wasting Hours on Repetitive Windows Tasks
          </header>
          <p className='planit-dashboard-upper-description'>
            <strong>Are you tired of clicking the same buttons, opening the same programs, and doing the same tasks every single day?</strong> 
            <br/><br/>
            Simple.NET learns your Windows habits and automates your routine tasks - saving you 2-4 hours every day. 
            Join thousands of professionals who've already reclaimed their time and boosted their productivity by 300%.
          </p>
          <div className='social-proof-stats'>
            <div className='stat'>
              <span className='stat-number'>2,847</span>
              <span className='stat-label'>Hours Saved Daily</span>
            </div>
            <div className='stat'>
              <span className='stat-number'>95%</span>
              <span className='stat-label'>User Satisfaction</span>
            </div>
            <div className='stat'>
              <span className='stat-number'>24/7</span>
              <span className='stat-label'>AI Assistant</span>
            </div>
          </div>
        </div>

        {/* Problem-Solution Section */}
        <div className='problem-solution-section'>
          <h2>The Windows Productivity Crisis</h2>
          <div className='problems-grid'>
            <div className='problem-item'>
              <span className='problem-icon'>😤</span>
              <h3>Endless Clicking</h3>
              <p>You waste 45+ minutes daily on repetitive tasks like opening the same applications, navigating to frequent folders, and managing windows.</p>
            </div>
            <div className='problem-item'>
              <span className='problem-icon'>🐌</span>
              <h3>Slow Workflows</h3>
              <p>Your computer doesn't learn from your patterns. Every day feels like the first day, forcing you to manually guide every action.</p>
            </div>
            <div className='problem-item'>
              <span className='problem-icon'>🧠</span>
              <h3>Mental Fatigue</h3>
              <p>Decision fatigue from countless micro-choices drains your energy for important creative and strategic work.</p>
            </div>
          </div>
          
          <div className='solution-callout'>
            <h3>Simple.NET Changes Everything</h3>
            <p>Our AI watches how you work and automatically handles your routine tasks. Imagine your computer becoming your personal assistant that knows exactly what you need, when you need it.</p>
          </div>
        </div>
        <div className='planit-dashboard-lower'>
          <div className='planit-dashboard-preview'>
            <h2>See Simple.NET in Action</h2>
            <div className='simple-graphic-container'>
              <img 
                src={simpleGraphic} 
                alt="Simple.NET System Intelligence Overview" 
                className='simple-graphic-img'
              />
            </div>
            
            {/* Enhanced Features with Benefits */}
            <div className='planit-dashboard-features'>
              <h2>Transform Your Windows Experience</h2>
              <div className='features-grid'>
                <div className='feature-card'>
                  <div className='feature-icon'>🧠</div>
                  <h3>Predictive Intelligence</h3>
                  <p><strong>Save 45+ minutes daily.</strong> Simple learns when you typically open Outlook at 9 AM, launches your development environment for afternoon coding sessions, and prepares your presentation tools before meetings.</p>
                  <div className='feature-benefit'>→ Never wait for apps to load again</div>
                </div>
                
                <div className='feature-card'>
                  <div className='feature-icon'>⚡</div>
                  <h3>Smart Automation</h3>
                  <p><strong>Eliminate 200+ daily clicks.</strong> Automatically organizes your desktop, backs up important files, and switches between work profiles based on time and context.</p>
                  <div className='feature-benefit'>→ Focus on what matters, not maintenance</div>
                </div>
                
                <div className='feature-card'>
                  <div className='feature-icon'>🎯</div>
                  <h3>Context Awareness</h3>
                  <p><strong>Boost focus by 300%.</strong> Recognizes when you're in "deep work" mode and automatically blocks distractions, dims notifications, and optimizes system performance.</p>
                  <div className='feature-benefit'>→ Enter flow state instantly</div>
                </div>
                
                <div className='feature-card'>
                  <div className='feature-icon'>📊</div>
                  <h3>Productivity Analytics</h3>
                  <p><strong>Track your efficiency gains.</strong> Get weekly reports showing time saved, productivity patterns, and personalized optimization suggestions.</p>
                  <div className='feature-benefit'>→ Measure and improve your performance</div>
                </div>
              </div>
            </div>

            {/* Testimonials Section */}
            <div className='testimonials-section'>
              <h2>What Our Beta Users Say</h2>
              <div className='testimonials-grid'>
                <div className='testimonial-card'>
                  <div className='testimonial-stars'>★★★★★</div>
                  <p>"Simple.NET gave me back 3 hours every day. My computer now feels like it reads my mind. I can't imagine working without it."</p>
                  <div className='testimonial-author'>
                    <strong>Sarah Chen</strong>
                    <span>Software Developer, Microsoft</span>
                  </div>
                </div>
                
                <div className='testimonial-card'>
                  <div className='testimonial-stars'>★★★★★</div>
                  <p>"As a consultant juggling 12 clients, Simple's context switching is a game-changer. It automatically sets up my workspace for each client. Incredible."</p>
                  <div className='testimonial-author'>
                    <strong>Marcus Rodriguez</strong>
                    <span>Management Consultant</span>
                  </div>
                </div>
                
                <div className='testimonial-card'>
                  <div className='testimonial-stars'>★★★★★</div>
                  <p>"The productivity analytics showed me I was wasting 90 minutes daily on file management. Now it's automated. ROI in the first week!"</p>
                  <div className='testimonial-author'>
                    <strong>Emily Watson</strong>
                    <span>Creative Director</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Pricing Section */}
            <div className='pricing-section'>
              <h2>Choose Your Productivity Level</h2>
              <p className='pricing-subtitle'>Limited-time beta pricing - 70% off regular price!</p>
              
              <div className='pricing-grid'>
                <div className={`pricing-card ${selectedPlan === 'starter' ? 'selected' : ''}`} onClick={() => setSelectedPlan('starter')}>
                  <div className='plan-header'>
                    <h3>Starter</h3>
                    <div className='plan-price'>
                      <span className='currency'>$</span>
                      <span className='amount'>9</span>
                      <span className='period'>/month</span>
                    </div>
                    <div className='plan-original-price'>Regular: $29/month</div>
                  </div>
                  <ul className='plan-features'>
                    <li>✓ Basic automation (5 workflows)</li>
                    <li>✓ Predictive app launching</li>
                    <li>✓ Simple analytics</li>
                    <li>✓ Email support</li>
                  </ul>
                  <div className='plan-cta'>
                    <button className='cta-button'>Start Free Trial</button>
                  </div>
                </div>

                <div className={`pricing-card featured ${selectedPlan === 'pro' ? 'selected' : ''}`} onClick={() => setSelectedPlan('pro')}>
                  <div className='popular-badge'>Most Popular</div>
                  <div className='plan-header'>
                    <h3>Professional</h3>
                    <div className='plan-price'>
                      <span className='currency'>$</span>
                      <span className='amount'>19</span>
                      <span className='period'>/month</span>
                    </div>
                    <div className='plan-original-price'>Regular: $59/month</div>
                  </div>
                  <ul className='plan-features'>
                    <li>✓ Unlimited automation workflows</li>
                    <li>✓ Advanced context awareness</li>
                    <li>✓ Detailed productivity analytics</li>
                    <li>✓ Custom integrations</li>
                    <li>✓ Priority support</li>
                    <li>✓ Team collaboration features</li>
                  </ul>
                  <div className='plan-cta'>
                    <button className='cta-button primary'>Get Pro Access</button>
                  </div>
                </div>

                <div className={`pricing-card ${selectedPlan === 'enterprise' ? 'selected' : ''}`} onClick={() => setSelectedPlan('enterprise')}>
                  <div className='plan-header'>
                    <h3>Enterprise</h3>
                    <div className='plan-price'>
                      <span className='currency'>$</span>
                      <span className='amount'>49</span>
                      <span className='period'>/month</span>
                    </div>
                    <div className='plan-original-price'>Regular: $149/month</div>
                  </div>
                  <ul className='plan-features'>
                    <li>✓ Everything in Professional</li>
                    <li>✓ Advanced security controls</li>
                    <li>✓ Company-wide deployment</li>
                    <li>✓ Custom training & onboarding</li>
                    <li>✓ Dedicated account manager</li>
                  </ul>
                  <div className='plan-cta'>
                    <button className='cta-button'>Contact Sales</button>
                  </div>
                </div>
              </div>

              <div className='guarantee-section'>
                <div className='guarantee-badge'>
                  <span className='guarantee-icon'>🛡️</span>
                  <div className='guarantee-text'>
                    <strong>30-Day Money-Back Guarantee</strong>
                    <p>Try Simple.NET risk-free. If you don't save at least 10 hours in your first month, get a full refund.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* FAQ Section */}
            <div className='faq-section'>
              <h2>Frequently Asked Questions</h2>
              <div className='faq-grid'>
                <div className='faq-item'>
                  <h3>Is my data safe and private?</h3>
                  <p>Absolutely. Simple.NET processes everything locally on your machine. Your usage patterns and data never leave your computer. We use enterprise-grade encryption for all local storage.</p>
                </div>
                
                <div className='faq-item'>
                  <h3>Will this slow down my computer?</h3>
                  <p>No, Simple.NET actually speeds up your system by optimizing resource usage and preventing unnecessary background processes. Most users see a 15-20% improvement in system performance.</p>
                </div>
                
                <div className='faq-item'>
                  <h3>How long before I see results?</h3>
                  <p>You'll notice immediate improvements in app launch times and workflow organization. The AI learns your patterns within 2-3 days and reaches full optimization within a week of normal usage.</p>
                </div>
                
                <div className='faq-item'>
                  <h3>What if I don't like it?</h3>
                  <p>We offer a 30-day money-back guarantee, no questions asked. Plus, you can easily uninstall Simple.NET without any impact on your existing system configuration.</p>
                </div>
                
                <div className='faq-item'>
                  <h3>Does it work with all Windows versions?</h3>
                  <p>Simple.NET supports Windows 10 (build 1909+) and Windows 11. It works seamlessly with all major applications and doesn't interfere with existing software.</p>
                </div>
                
                <div className='faq-item'>
                  <h3>Can I customize the automation?</h3>
                  <p>Yes! While Simple.NET learns automatically, you have full control over which automations to enable, modify, or disable. Create custom workflows for your specific needs.</p>
                </div>
              </div>
            </div>

            {/* Final CTA */}
            <div className='final-cta-section'>
              <h2>Ready to Reclaim Your Time?</h2>
              <p>Join thousands of professionals who save 2+ hours daily with Simple.NET</p>
              <div className='urgency-notice'>
                <span className='urgency-icon'>⏰</span>
                <strong>Beta pricing ends in 7 days</strong> - Save 70% now
              </div>
              <div className='final-cta-buttons'>
                <button className='cta-button primary large'>Start Your Free Trial</button>
                <a href={simplelink} className='secondary-link' target="_blank" rel="noopener noreferrer">
                  View Technical Details
                </a>
              </div>
            </div>
          </div>
        </div>
        <Footer />
      </div>
    </>
  );
}

export default Simple;
