import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { getMembershipPricing } from '../../../features/data/dataSlice';
import Header from './../../../components/Header/Header';
import './Simple.css';
import Footer from './../../../components/Footer/Footer';
import simpleGraphic from './simple_graphic.png';

const simplelink = "https://github.com/tnnrhpwd/C-Simple";

// Helper function to format price from cents to dollars
const formatPrice = (priceInCents) => {
  if (!priceInCents) return 'Free';
  const dollars = priceInCents / 100;
  return `$${dollars.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}`;
};

function Simple() {
  const [selectedPlan, setSelectedPlan] = useState('premium');
  const dispatch = useDispatch();
  const navigate = useNavigate();
  
  // Get membership pricing from Redux store
  const { membershipPricing } = useSelector(state => state.data);

  // Fetch membership pricing when component mounts
  useEffect(() => {
    dispatch(getMembershipPricing());
  }, [dispatch]);

  // Generate plans with dynamic pricing if available
  const getPlans = () => {
    // If we have dynamic pricing data, use it
    if (membershipPricing && membershipPricing.success && membershipPricing.data && membershipPricing.data.length > 0) {
      return membershipPricing.data.map(product => ({
        id: product.id,
        name: product.name,
        price: product.price ? formatPrice(product.price) : 'Usage-based',
        period: `per ${product.interval || 'month'}`,
        originalPrice: product.originalPrice ? formatPrice(product.originalPrice) : null,
        tagline: product.description || '',
        features: (product.features || []).map(feature => 
          typeof feature === 'string' ? feature.replace(/^[✓✔︎☑️✅•→▶▷◾◼️⬛⚫🔸🔹🔘•·‣⁃]\s*/, '').trim() : feature
        ),
        quota: product.quota || {},
      }));
    }
    
    // Fallback to static plans if no dynamic pricing available
    return [
      {
        id: 'free',
        name: 'Free Tier',
        price: '$0',
        period: 'per month',
        tagline: 'Perfect for trying Simple.NET',
        features: [
          'Limited automation (3 workflows)',
          'Basic app launching',
          'Simple analytics',
        ],
      },
      {
        id: 'flex',
        name: 'Flex',
        price: 'Usage-based',
        period: 'starting at $0.50/month',
        tagline: 'Pay only for what you use',
        features: [
          'Unlimited automation workflows',
          'Advanced context awareness', 
          'Detailed productivity analytics',
        ],
      },
      { 
        id: 'premium',
        name: 'Premium',
        price: 'Usage-based',
        period: 'with custom limits',
        tagline: 'Maximum efficiency with predictable costs',
        features: [
          'Reduced per-usage rates (save up to 30%)',
          'Set your own monthly maximum',
          'Advanced analytics with insights',
        ],
      }
    ];
  };

  const plans = getPlans();

  // Handle plan selection and redirect to checkout
  const handleGetStarted = (planId) => {
    if (planId === 'free') {
      // For free plan, redirect to pay page to handle free subscription
      navigate(`/pay?plan=${planId}`);
    } else {
      // For paid plans, redirect to pay page with selected plan
      navigate(`/pay?plan=${planId}`);
    }
  };

  return (
    <>
      <Header />
      <div className='planit-dashboard'>
        <div className='planit-dashboard-upper'>
          <div className='early-access-badge'>
            🚀 Early Access - Limited Time Beta Pricing
          </div>
          <header className='planit-dashboard-upper-header'>
            Stop Wasting Hours on Repetitive Windows Tasks
          </header>
          <p className='planit-dashboard-upper-description'>
            <strong>Are you tired of clicking the same buttons, opening the same programs, and doing the same tasks every single day?</strong> 
            <br/><br/>
            Simple.NET learns your Windows habits and automates your routine tasks, saving you hours every day. 
            Reclaim your time and boost your productivity significantly.
          </p>
        </div>

        {/* Problem-Solution Section */}
        <div className='problem-solution-section'>
          <h2>The Windows Productivity Crisis</h2>
          <div className='problems-grid'>
            <div className='problem-item'>
              <span className='problem-icon'>😤</span>
              <h3>Endless Clicking</h3>
              <p>You waste significant time daily on repetitive tasks like opening the same applications, navigating to frequent folders, and managing windows.</p>
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
                  <p><strong>Save time daily.</strong> Simple learns when you typically open Outlook in the morning, launches your development environment for afternoon coding sessions, and prepares your presentation tools before meetings.</p>
                  <div className='feature-benefit'>→ Never wait for apps to load again</div>
                </div>
                
                <div className='feature-card'>
                  <div className='feature-icon'>⚡</div>
                  <h3>Smart Automation</h3>
                  <p><strong>Eliminate countless daily clicks.</strong> Automatically organizes your desktop, backs up important files, and switches between work profiles based on time and context.</p>
                  <div className='feature-benefit'>→ Focus on what matters, not maintenance</div>
                </div>
                
                <div className='feature-card'>
                  <div className='feature-icon'>🎯</div>
                  <h3>Context Awareness</h3>
                  <p><strong>Boost focus significantly.</strong> Recognizes when you're in "deep work" mode and automatically blocks distractions, dims notifications, and optimizes system performance.</p>
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

            {/* Pricing Section */}
            <div className='pricing-section'>
              <h2>Choose Your Productivity Level</h2>              
              <div className='pricing-grid'>
                {plans.map((plan, index) => (
                  <div 
                    key={plan.id}
                    className={`pricing-card ${selectedPlan === plan.id ? 'selected' : ''} ${plan.id === 'premium' ? 'featured' : ''}`} 
                    onClick={() => setSelectedPlan(plan.id)}
                  >
                    {plan.id === 'premium' && <div className='popular-badge'>Most Popular</div>}
                    <div className='plan-header'>
                      <h3>{plan.name}</h3>
                      <p className='plan-tagline'>{plan.tagline}</p>
                      <div className='plan-price'>
                        {plan.price === '$0' ? (
                          <>
                            <span className='currency'>$</span>
                            <span className='amount'>0</span>
                            <span className='period'>/month</span>
                          </>
                        ) : plan.price === 'Usage-based' ? (
                          <>
                            <span className='usage-based'>Usage-based</span>
                            <span className='period'>{plan.period}</span>
                          </>
                        ) : (
                          <>
                            <span className='price-text'>{plan.price}</span>
                            <span className='period'>{plan.period}</span>
                          </>
                        )}
                      </div>
                      {plan.originalPrice && (
                        <div className='plan-original-price'>Regular: {plan.originalPrice}</div>
                      )}
                    </div>
                    <ul className='plan-features'>
                      {plan.features.map((feature, featureIndex) => (
                        <li key={featureIndex}>{feature}</li>
                      ))}
                    </ul>
                    <div className='plan-cta'>
                      <button 
                        className={`cta-button ${plan.id === 'premium' ? 'primary' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleGetStarted(plan.id);
                        }}
                      >
                        {plan.id === 'free' ? 'Start Free' : 'Get Started'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className='guarantee-section'>
                <div className='guarantee-badge'>
                  <span className='guarantee-icon'>🛡️</span>
                  <div className='guarantee-text'>
                    <strong>Risk-Free Trial</strong>
                    <p>Start with our Free tier and upgrade anytime. Cancel or downgrade without penalty.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Final CTA */}
            <div className='final-cta-section'>
              <h2>Ready to Reclaim Your Time?</h2>
              <p>Join professionals who save hours daily with Simple.NET</p>
              <div className='urgency-notice'>
                <span className='urgency-icon'>⚡</span>
                <strong>Start Free, Pay Only for What You Use</strong>
              </div>
              <div className='final-cta-buttons'>
                <button 
                  className='cta-button primary large'
                  onClick={() => handleGetStarted('free')}
                >
                  Start Free Now
                </button>
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
