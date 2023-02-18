import React, { useState } from 'react';
import Footer from '../Footer/Footer';
import NavBar from '../NavBar/NavBar';
import './PassGen.css';

function PassGen() {
    const [outputPassword, setOutputPassword] = useState("");
    const [hasUppercase, setHasUppercase] = useState(true);
    const [hasLowercase, setHasLowercase] = useState(true);
    const [hasNumbers, setHasNumbers] = useState(true);
    const [hasSymbols, setHasSymbols] = useState(true);
    const [length, setLength] = useState(15);
    const [outcome, setOutcome] = useState("");

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
        if(pwLength === '0'){setOutcome("Increase the password length.")} else {setOutcome("");}
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
        <NavBar/>
        <div className='passgen'>
            <div className="passgen-title">
                PassGen
            </div>
            <div className="passgen-description">
                This calculator inputs alarm time & sleep duration, and it outputs the time to go to sleep. Use the 24 hour time format.
            </div>

            <div className='passgen-col1'>
                <div className='passgen-calculator'>
                    <div className='passgen-calculator-slider'>
                        <label id='passgen-calculator-label' htmlFor="passgen-calculator-slider">Slider:</label>
                        <input type="range" id="passgen-calculator-slider" min="0" max="100" value={length} onChange={handleSetLength} />
                        <div id='passgen-calculator-slider-length'>{length}</div>
                    </div>
                    <div className='passgen-calculator-uppercase'>
                        <label id='passgen-calculator-label' htmlFor="passgen-calculator-checkbox">HasUppercase:</label>
                        <input type="checkbox" id="passgen-calculator-checkbox" checked={hasUppercase} onChange={handleSetHasUppercase} />
                    </div>
                    <div className='passgen-calculator-lowercase'>
                        <label id='passgen-calculator-label' htmlFor="passgen-calculator-checkbox">HasLowercase:</label>
                        <input type="checkbox" id="passgen-calculator-checkbox" checked={hasLowercase} onChange={handleSetHasLowercase} />
                    </div>
                    <div className='passgen-calculator-numbers'>
                        <label id='passgen-calculator-label' htmlFor="passgen-calculator-checkbox">HasNumbers:</label>
                        <input type="checkbox" id="passgen-calculator-checkbox" checked={hasNumbers} onChange={handleSetHasNumbers} />
                    </div>
                    <div className='passgen-calculator-symbols'>
                        <label id='passgen-calculator-label' htmlFor="passgen-calculator-checkbox">HasSymbols:</label>
                        <input type="checkbox" id="passgen-calculator-checkbox" checked={hasSymbols} onChange={handleSetHasSymbols} />
                    </div>

                    <button id="passgen-calculator-submit" onClick={handleCopyToClipboard}>Copy to Clipboard</button>
                    <button id="passgen-calculator-submit" onClick={handleSubmit}>Regenerate</button>
                    <br></br>
                    <br></br>

                    <textarea id="passgen-calculator-output" value={outputPassword}/>

                    <div id='passgen-calculator-outcome'>{outcome}</div>

                </div>
            </div>

            <br/>
            <a href="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/PassGen" rel="noopener noreferrer"  target="_blank">
                <button id="passgen-sourcecode">View Source Code</button>
            </a>

        </div>
        <Footer/>
    </>)
}

export default PassGen