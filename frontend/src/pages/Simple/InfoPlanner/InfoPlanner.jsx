import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import './InfoPlanner.css';

function InfoPlanner() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    {
      title: "Prepare Your Paper Planner",
      content: (
        <div className='info-planner-step-content'>
          <div className='info-planner-step-text'>
            <h3>🗓️ Get Your Paper and Tools Ready</h3>
            <p>Start with a clean sheet of paper or your favorite planner. You'll want to use a pen or pencil with good contrast for easy reading later.</p>
            
            <div className='info-planner-tips'>
              <h4>📝 Best Practices:</h4>
              <ul>
                <li>Use dark ink (black or blue) on white/light paper</li>
                <li>Write clearly and legibly</li>
                <li>Leave some space between entries</li>
                <li>Use consistent formatting</li>
              </ul>
            </div>
          </div>
          <div className='info-planner-example-image'>
            <div className='info-planner-placeholder-image'>
              📋 Example Paper Setup
            </div>
          </div>
        </div>
      )
    },
    {
      title: "Track Your Actions with Times",
      content: (
        <div className='info-planner-step-content'>
          <div className='info-planner-step-text'>
            <h3>⏰ Record Actions Throughout Your Week</h3>
            <p>As you complete tasks and activities, write them down with their start times. This creates a detailed record of how you spend your time.</p>
            
            <div className='info-planner-format-example'>
              <h4>✍️ Format Example:</h4>
              <div className='info-planner-code-block'>
                <code>9:00 AM - Team meeting preparation</code><br/>
                <code>10:30 AM - Client presentation</code><br/>
                <code>12:00 PM - Lunch break</code><br/>
                <code>1:00 PM - Code review session</code><br/>
                <code>3:30 PM - Documentation update</code>
              </div>
            </div>

            <div className='info-planner-tips'>
              <h4>🎯 Pro Tips:</h4>
              <ul>
                <li>Include both work and personal activities</li>
                <li>Note duration if helpful (e.g., "2-hour meeting")</li>
                <li>Add context when useful ("urgent bug fix")</li>
                <li>Track breaks and transitions</li>
              </ul>
            </div>
          </div>
          <div className='info-planner-example-image'>
            <div className='info-planner-placeholder-image'>
              📝 Sample Daily Log
            </div>
          </div>
        </div>
      )
    },
    {
      title: "Take a Clear Photo",
      content: (
        <div className='info-planner-step-content'>
          <div className='info-planner-step-text'>
            <h3>📸 Capture Your Week's Work</h3>
            <p>At the end of your week (or whenever you want to analyze your productivity), take a clear photo of your planner pages.</p>
            
            <div className='info-planner-tips'>
              <h4>📷 Photo Guidelines:</h4>
              <ul>
                <li>Use good lighting - natural light works best</li>
                <li>Keep the camera steady and straight</li>
                <li>Ensure all text is visible and in focus</li>
                <li>Avoid shadows over your writing</li>
                <li>Take multiple shots if needed for different pages</li>
              </ul>
            </div>

            <div className='info-planner-photo-tips'>
              <h4>🔧 Technical Tips:</h4>
              <ul>
                <li>Hold your phone/camera directly above the paper</li>
                <li>Use the grid feature to keep lines straight</li>
                <li>Tap to focus on the text before taking the shot</li>
                <li>Review the photo to ensure text is readable</li>
              </ul>
            </div>
          </div>
          <div className='info-planner-example-image'>
            <div className='info-planner-placeholder-image'>
              📱 Photo Quality Example
            </div>
          </div>
        </div>
      )
    },
    {
      title: "Upload and Analyze",
      content: (
        <div className='info-planner-step-content'>
          <div className='info-planner-step-text'>
            <h3>🚀 Get AI-Powered Insights</h3>
            <p>Upload your photo to the Plans page and let our AI analyze your productivity patterns, time allocation, and suggest improvements.</p>
            
            <div className='info-planner-benefits'>
              <h4>🎯 What You'll Get:</h4>
              <ul>
                <li><strong>Text Extraction:</strong> OCR converts handwriting to digital text</li>
                <li><strong>Time Analysis:</strong> AI identifies patterns in your schedule</li>
                <li><strong>Productivity Insights:</strong> Discover peak performance times</li>
                <li><strong>Actionable Recommendations:</strong> Optimize your workflow</li>
              </ul>
            </div>

            <div className='info-planner-action-buttons'>
              <button 
                className='info-planner-cta-primary'
                onClick={() => navigate('/plans')}
              >
                📋 Go to Plans Page
              </button>
              <button 
                className='info-planner-cta-secondary'
                onClick={() => navigate('/InfoData/example')}
              >
                🔍 See Analysis Example
              </button>
            </div>
          </div>
          <div className='info-planner-example-image'>
            <div className='info-planner-placeholder-image'>
              📊 AI Analysis Results
            </div>
          </div>
        </div>
      )
    }
  ];

  const nextStep = () => {
    setActiveStep((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const prevStep = () => {
    setActiveStep((prev) => Math.max(prev - 1, 0));
  };

  return (
    <>
      <Header />
      <div className="info-planner">
        <button 
          className="info-planner-back-button"
          onClick={() => navigate(-1)}
        >
          ← Back
        </button>

        <div className="info-planner-header">
          <h1 className="info-planner-title">📋 Paper Planner Tutorial</h1>
          <p className="info-planner-subtitle">
            Transform your handwritten weekly actions into powerful AI-driven productivity insights
          </p>
        </div>

        <div className="info-planner-container">
          <div className="info-planner-steps">
            <div className="info-planner-progress">
              {steps.map((step, index) => (
                <div 
                  key={index}
                  className={`info-planner-progress-step ${
                    index === activeStep ? 'active' : ''
                  } ${
                    index < activeStep ? 'completed' : ''
                  }`}
                  onClick={() => setActiveStep(index)}
                >
                  <div className="info-planner-step-number">{index + 1}</div>
                  <div className="info-planner-step-title">{step.title}</div>
                </div>
              ))}
            </div>

            <div className="info-planner-step-container">
              {steps[activeStep].content}
            </div>

            <div className="info-planner-navigation">
              <button 
                className="info-planner-nav-button"
                onClick={prevStep}
                disabled={activeStep === 0}
              >
                ← Previous
              </button>
              
              <div className="info-planner-step-indicator">
                Step {activeStep + 1} of {steps.length}
              </div>
              
              {activeStep < steps.length - 1 ? (
                <button 
                  className="info-planner-nav-button"
                  onClick={nextStep}
                >
                  Next →
                </button>
              ) : (
                <button 
                  className="info-planner-nav-button"
                  onClick={() => navigate('/plans')}
                  style={{
                    background: 'linear-gradient(45deg, var(--fg-orange), var(--fg-pink))',
                  }}
                >
                  Start Planning! 🚀
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}

export default InfoPlanner;