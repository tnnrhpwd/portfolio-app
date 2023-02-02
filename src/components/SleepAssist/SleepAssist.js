import React, { useState, useEffect } from 'react';
import Footer from '../Footer/Footer';
import NavBar from '../NavBar/NavBar';
import { getSunrise, getSunset } from 'sunrise-sunset-js';
import './SleepAssist.css';

function SleepAssist() {
    const [wakeTime, setWakeTime] = useState(0);
    const [bedTime, setBedTime] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);

    function handleSubmit(){
        // GUARD CLAUSE --
        if((wakeTime===bedTime)){ return; }

    }
    function getAllTimes(){
        setCurrentTime(new Date())
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
               <input placeholder='alarm time ex. 500'></input>
               <input placeholder='sleep duration ex. 800'></input>

                <div>the output</div>
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