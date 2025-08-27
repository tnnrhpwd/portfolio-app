import React, { useState, useEffect } from 'react';
import Footer from '../../../components/Footer/Footer';
import './PassGen.css';
import Header from '../../../components/Header/Header';

function PassGen() {
    const [outputPassword, setOutputPassword] = useState("");
    const [hasUppercase, setHasUppercase] = useState(true);
    const [hasLowercase, setHasLowercase] = useState(true);
    const [hasNumbers, setHasNumbers] = useState(true);
    const [hasSymbols, setHasSymbols] = useState(true);
    const [length, setLength] = useState(15);
    const [outcome, setOutcome] = useState("");
    const [displayedTitle, setDisplayedTitle] = useState("");
    const [isTyping, setIsTyping] = useState(true);
    const [animationPhase, setAnimationPhase] = useState(0);

    const titleText = "PassGen";
    
    // Typewriter effect for the title
    useEffect(() => {
        let timeout;
        if (isTyping && displayedTitle.length < titleText.length) {
            timeout = setTimeout(() => {
                setDisplayedTitle(titleText.substring(0, displayedTitle.length + 1));
            }, 150);
        } else if (isTyping && displayedTitle.length === titleText.length) {
            setIsTyping(false);
            setTimeout(() => setAnimationPhase(1), 500);
        }
        return () => clearTimeout(timeout);
    }, [displayedTitle, isTyping, titleText]);

    function handleSubmit(){
        calculatePassword(length, hasUppercase, hasLowercase, hasNumbers, hasSymbols)
    }
    const handleCopyToClipboard = () => {
        navigator.clipboard.writeText(outputPassword);
        setOutcome('Copied to clipboard!');
      };
    const handleSetLength = (event) => {
        setLength(event.target.value);
    }
    const handleSetHasUppercase = () => {
      setHasUppercase(!hasUppercase);
    }
    const handleSetHasLowercase = () => {
        setHasLowercase(!hasLowercase);
    }
    const handleSetHasNumbers = () => {
        setHasNumbers(!hasNumbers);
    }
    const handleSetHasSymbols = () => {
        setHasSymbols(!hasSymbols);
    }

    /* This javascript function takes two inputs (wakeup time, sleep duration) in standard army time and outputs the bedtime*/
    function calculatePassword(pwLength, pwHasUppercase, pwHasLowercase, pwHasNumbers, pwHasSymbols) {
        if(!pwHasUppercase && !pwHasLowercase && !pwHasNumbers && !pwHasSymbols){
            setOutcome("Please select any of the checkboxes.");
            setOutputPassword("");
            return
        } else{
            setOutcome("");
        }
        var uppercaseChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        var lowercaseChars = "abcdefghijklmnopqrstuvwxyz";
        var numberChars = "0123456789";
        var symbolChars = "!@#$%^&*()_+-={}[]|;:<>,.?/";
      
        var allChars = "";
        var password = "";
      
        if (pwHasUppercase) {
          allChars += uppercaseChars;
        }
      
        if (pwHasLowercase) {
          allChars += lowercaseChars;
        }
      
        if (pwHasNumbers) {
          allChars += numberChars;
        }
      
        if (pwHasSymbols) {
          allChars += symbolChars;
        }
      
        for (var i = 0; i < pwLength; i++) {
          var randomChar = allChars[Math.floor(Math.random() * allChars.length)];
          password += randomChar;
        }
        setOutputPassword(password);
    }

    return (<>
        <Header />
        <div className="container">
            {/* Floating elements for visual interest */}
            <div className="floating-shapes">
                <div className="floating-circle floating-circle-1"></div>
                <div className="floating-circle floating-circle-2"></div>
                <div className="floating-circle floating-circle-3"></div>
            </div>
            
            <section className="section-tile hero-section">
                <div id="content-tile">
                    <div id="text-title" className="typewriter">
                        {displayedTitle}<span className="cursor">|</span>
                    </div>
                    <div id="text-body" className={`fade-in-up ${animationPhase >= 1 ? 'visible' : ''}`}>
                        Generate secure passwords with your custom criteria
                    </div>
                    <div id="text-subtext" className={`fade-in-up ${animationPhase >= 1 ? 'visible' : ''}`}>
                        Choose length, character types, and copy instantly
                    </div>
                </div>
            </section>

            <section className="section-tile calculator-section">
                <div id="content-tile">
                    <div className='passgen-calculator animate-in'>
                        <div className='passgen-calculator-slider'>
                            <label id='passgen-calculator-label' htmlFor="passgen-calculator-slider">
                                Password Length: {length}
                            </label>
                            <input 
                                type="range" 
                                id="passgen-calculator-slider" 
                                min="3" 
                                max="512" 
                                value={length} 
                                onChange={handleSetLength} 
                            />
                        </div>

                        <div className='passgen-options-grid'>
                            <div className='passgen-calculator-checkholder animate-in'>
                                <label id='passgen-calculator-label' htmlFor="uppercase-checkbox">
                                    Has Uppercase
                                </label>
                                <input 
                                    type="checkbox" 
                                    id="uppercase-checkbox" 
                                    className="passgen-calculator-checkbox"
                                    checked={hasUppercase} 
                                    onChange={handleSetHasUppercase} 
                                />
                            </div>
                            
                            <div className='passgen-calculator-checkholder animate-in'>
                                <label id='passgen-calculator-label' htmlFor="lowercase-checkbox">
                                    Has Lowercase
                                </label>
                                <input 
                                    type="checkbox" 
                                    id="lowercase-checkbox" 
                                    className="passgen-calculator-checkbox"
                                    checked={hasLowercase} 
                                    onChange={handleSetHasLowercase} 
                                />
                            </div>
                            
                            <div className='passgen-calculator-checkholder animate-in'>
                                <label id='passgen-calculator-label' htmlFor="numbers-checkbox">
                                    Has Numbers
                                </label>
                                <input 
                                    type="checkbox" 
                                    id="numbers-checkbox" 
                                    className="passgen-calculator-checkbox"
                                    checked={hasNumbers} 
                                    onChange={handleSetHasNumbers} 
                                />
                            </div>
                            
                            <div className='passgen-calculator-checkholder animate-in'>
                                <label id='passgen-calculator-label' htmlFor="symbols-checkbox">
                                    Has Symbols
                                </label>
                                <input 
                                    type="checkbox" 
                                    id="symbols-checkbox" 
                                    className="passgen-calculator-checkbox"
                                    checked={hasSymbols} 
                                    onChange={handleSetHasSymbols} 
                                />
                            </div>
                        </div>

                        <div className='passgen-buttons'>
                            <button 
                                id="passgen-calculator-generate" 
                                className="primary-btn"
                                onClick={handleSubmit}
                            >
                                🔐 Generate Password
                            </button>
                            <button 
                                id="passgen-calculator-copy" 
                                className="secondary-btn"
                                onClick={handleCopyToClipboard}
                                disabled={!outputPassword}
                            >
                                📋 Copy to Clipboard
                            </button>
                        </div>

                        <div className='passgen-output-section'>
                            <textarea 
                                id="passgen-calculator-output" 
                                value={outputPassword}
                                placeholder="Your generated password will appear here..."
                                readOnly
                            />
                            
                            {outcome && (
                                <div id='passgen-calculator-outcome' className={outcome.includes('Copied') ? 'success' : 'error'}>
                                    {outcome}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </section>

            <section className="section-tile source-section">
                <div id="content-tile">
                    <a href="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/PassGen" 
                       rel="noopener noreferrer" 
                       target="_blank"
                       className="source-link">
                        <button id="passgen-sourcecode" className="source-btn">
                            <span className="source-icon">💻</span>
                            View Source Code
                        </button>
                    </a>
                </div>
            </section>
            
            <Footer/>
        </div>
    </>)
}

export default PassGen