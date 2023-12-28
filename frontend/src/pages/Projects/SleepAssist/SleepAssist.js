import React, { useState } from 'react';
import Footer from '../../../components/Footer/Footer';
import NavBar from '../../../components/NavBar/NavBar';
import './SleepAssist.css';

function SleepAssist() {
    const [wakeTime, setWakeTime] = useState(0);
    const [bedTime, setBedTime] = useState('');
    const [addTime, setAddTime] = useState(0);

    function handleSubmit(){
        setBedTime(calculateBedtime(wakeTime, addTime))
    }
    // This Javascript function returns true if the two input strings 


    function calculateBedtime(wakeup, duration) {
        if (!/^\d{1,4}(?::\d{2})?$/.test(wakeup) || !/^\d{1,4}(?::\d{2})?$/.test(duration)) {
            return "Invalid time format.";
        }
    
        let [wakeupHours, wakeupMinutes] = wakeup.padStart(4, "0").match(/\d{2}/g).map(Number);
        let [durationHours, durationMinutes] = duration.padStart(4, "0").match(/\d{2}/g).map(Number);
    
        let bedtimeMinutes = wakeupMinutes - durationMinutes;
        let bedtimeHours = wakeupHours - durationHours;
        if (bedtimeMinutes < 0) {
            bedtimeMinutes += 60;
            bedtimeHours--;
        }
        if (bedtimeHours < 0) {
            bedtimeHours += 24;
        }
    
        let bedtimePeriod = bedtimeHours >= 12 ? "PM" : "AM";
        let bedtimeHours12 = (bedtimeHours % 12) || 12;
        let bedtimeMinutesFormatted = ("0" + bedtimeMinutes).slice(-2);
        let bedtime = `${("0" + bedtimeHours).slice(-2)}:${bedtimeMinutesFormatted}`;
        let bedtime12 = `${bedtimeHours12}:${bedtimeMinutesFormatted} ${bedtimePeriod}`;
    
        return(`${bedtime} ( ${bedtime12} )`);
    }
    
    const handleKeyPress = event => {
        if (event.key === "Enter") {
            handleSubmit();
        }
    };

    return (<>
        <NavBar/>
        <div className='sleepassist'>
            <div className="sleepassist-title">
                SleepAssist
            </div>
            <div className="sleepassist-description">
                This calculator inputs alarm time & sleep duration, and it outputs the time to go to sleep. Use the 24 hour time format.
            </div>

            <div className='sleepassist-col1'>
                <div className='sleepassist-calculator'>
                    {/* <input id="sleepassist-calculator-input" placeholder='current time (optional)' onChange={e => setWakeTime(e.target.value)} type="text"/> */}
                    <input id="sleepassist-calculator-input" placeholder='alarm time ex. 545' onChange={e => setWakeTime(e.target.value)} onKeyDown={handleKeyPress} type="text"/>
                    <br></br>
                    <input id="sleepassist-calculator-input" placeholder='sleep duration ex. 816' onChange={e => setAddTime(e.target.value)} onKeyDown={handleKeyPress} type="text"/>
                    <br></br>

                    <button id="sleepassist-calculator-submit" onClick={handleSubmit}>Calculate Bedtime</button>

                    <div id="sleepassist-calculator-output">{bedTime}</div>
                </div>
            </div>

            <br/>
            <a href="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/SleepAssist" rel="noopener noreferrer"  target="_blank">
                <button id="sleepassist-sourcecode">View Source Code</button>
            </a>

        </div>
        <Footer/>
    </>)
}

export default SleepAssist