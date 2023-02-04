import React, { useState, useEffect } from 'react';
import Footer from '../Footer/Footer';
import NavBar from '../NavBar/NavBar';
import './SleepAssist.css';

function SleepAssist() {
    const [wakeTime, setWakeTime] = useState(0);
    const [bedTime, setBedTime] = useState('');
    const [addTime, setAddTime] = useState(0);

    function handleSubmit(){
        calculateBedtime(wakeTime, addTime)
    }
    // This Javascript function returns true if the two input strings 



    /* This javascript function takes two inputs (wakeup time, sleep duration) in standard army time and outputs the bedtime*/
    function calculateBedtime(wakeup, duration) {
        if (!/^\d{1,4}(?::\d{2})?$/.test(wakeup) || !/^\d{1,4}(?::\d{2})?$/.test(duration)) {
            setBedTime("Invalid time format.");
            return;
        }
        let wakeupHours, wakeupMinutes, durationHours, durationMinutes;
    
        if (wakeup.indexOf(":") !== -1) {
            [wakeupHours, wakeupMinutes] = wakeup.split(":");
        } else if (wakeup.length === 4) {
            wakeupHours = wakeup.slice(0, 2);
            wakeupMinutes = wakeup.slice(2);
        } else if (wakeup.length === 3) {
            wakeupHours = wakeup[0];
            wakeupMinutes = wakeup.slice(1);
        } else if (wakeup.length === 2) {
            wakeupHours = 0;
            wakeupMinutes = wakeup;
        } else if (wakeup.length === 1) {
            wakeupHours = 0;
            wakeupMinutes = `0${wakeup}`;
        }
    
        wakeupHours = parseInt(wakeupHours);
        wakeupMinutes = parseInt(wakeupMinutes);
    
        if (duration.indexOf(":") !== -1) {
            [durationHours, durationMinutes] = duration.split(":");
        } else if (duration.length === 4) {
            durationHours = duration.slice(0, 2);
            durationMinutes = duration.slice(2);
        } else if (duration.length === 3) {
            durationHours = duration[0];
            durationMinutes = duration.slice(1);
        } else if (duration.length === 2) {
            durationHours = 0;
            durationMinutes = duration;
        } else if (duration.length === 1) {
            durationHours = 0;
            durationMinutes = `0${duration}`;
        }
    
        durationHours = parseInt(durationHours);
        durationMinutes = parseInt(durationMinutes);
    
        let bedtimeMinutes = (wakeupHours * 60 + wakeupMinutes) - (durationHours * 60 + durationMinutes);
        let bedtimeHours = Math.floor(bedtimeMinutes / 60);
        bedtimeMinutes = bedtimeMinutes % 60;
    
        // Adjust for negative values
        if (bedtimeMinutes < 0) {
            bedtimeMinutes += 60;
            bedtimeHours -= 1;
        }
        if (bedtimeHours < 0) {
            bedtimeHours += 24;
        }
    
        // Adjust for values greater than or equal to 24
        bedtimeHours = bedtimeHours % 24;
    
        let bedtime = `${("0" + bedtimeHours).slice(-2)}:${("0" + bedtimeMinutes).slice(-2)}`;
        let bedtime12 = `${bedtimeHours % 12 || 12}:${("0" + bedtimeMinutes).slice(-2)} ${bedtimeHours >= 12 ? "PM" : "AM"}`;
    
        setBedTime(`${bedtime} ( ${bedtime12} )`);
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