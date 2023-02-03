import React, { useState, useEffect } from 'react';
import Footer from '../Footer/Footer';
import NavBar from '../NavBar/NavBar';
import { getSunrise, getSunset } from 'sunrise-sunset-js';
import './SleepAssist.css';

function SleepAssist() {
    const [wakeTime, setWakeTime] = useState(0);
    const [bedTime, setBedTime] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [addTime, setAddTime] = useState(0);

    function handleSubmit(){
        calcBedTime(wakeTime, addTime)
    }
    function getAllTimes(){
        setCurrentTime(new Date())
    }
    function calcBedTime(wt, at) {
        // GUARD CLAUSE --
        if( wt===at || wt > 2359 || wt < 0 || at > 2359 || at < 0  || wt[3] > 5){ return; }
        var liqBed = parseInt(wt)-parseInt(at)
        if(liqBed < 0){
            liqBed = 2400 + liqBed
        }
        setBedTime(liqBed)
    }

    useEffect(() => {
        getAllTimes()
    }, [])
    
    return (<>
        <NavBar/>
        <div className='sleepassist'>
            <div className="sleepassist-title">
                SleepAssist
            </div>
            <div className="sleepassist-description">
                This calculator inputs alarm time & sleep duration, and it outputs the time to go to sleep. 
            </div>

            <div className='sleepassist-col1'>
                <div className='sleepassist-calculator'>
                    {/* <input id="sleepassist-calculator-input" placeholder='current time (optional)' onChange={e => setWakeTime(e.target.value)} type="text"/> */}
                    <input id="sleepassist-calculator-input" placeholder='alarm time ex. 500' onChange={e => setWakeTime(e.target.value)} type="text"/>
                    <input id="sleepassist-calculator-input" placeholder='sleep duration ex. 800' onChange={e => setAddTime(e.target.value)} type="text"/>

                    <button id="sleepassist-calculator-submit" onClick={handleSubmit}>Calculate Wake-up Time</button>

                    <div>{bedTime}</div>
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