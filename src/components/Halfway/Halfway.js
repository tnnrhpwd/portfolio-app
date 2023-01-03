import React, { useState, useEffect } from 'react';
import Footer from '../Footer/Footer';
import NavBar from './../NavBar/NavBar';
import { getSunrise, getSunset } from 'sunrise-sunset-js';
import './Halfway.css';

function Halfway() {
    const [endTime, setEndTime] = useState(0);
    const [startTime, setStartTime] = useState(0);
    const [halfwayTime, setHalfwayTime] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [sunriseTime, setSunriseTime] = useState("");
    const [sunsetTime, setSunsetTime] = useState("");

    function handleSubmit(){
        // GUARD CLAUSE --
        if((endTime===startTime)){ return; }
        let answer = parseInt((endTime-startTime)/2)+parseFloat(startTime) // calculate halfway point
        setHalfwayTime(answer);
    }
    function getSunTimesFromLocation(){
        // Combined with geolocation. Sunset tonight at your location.
        navigator.geolocation.getCurrentPosition(function(position) {
            setSunriseTime( getSunrise(position.coords.latitude, position.coords.longitude) );
            setSunsetTime( getSunset(position.coords.latitude, position.coords.longitude) );
        });
    }
    function getAllTimes(){
        setCurrentTime(new Date())
        getSunTimesFromLocation()
    }

    useEffect(() => {
        getAllTimes()
    }, [])
    
    return (<>
        <NavBar/>
        <div className='halfway'>
            <div className="halfway-title">
                Halfway
            </div>
            <div className="halfway-description">
                This calculator estimates the halfway time of any trip. 
            </div>

            <div className='halfway-col1'>
                <div className='halfway-calculator'>
                    <div className='halfway-calculator-title'>
                        Time Calculator
                    </div>



                    <div className='halfway-calculator-start'>
                        <div className='halfway-calculator-input-title'>
                            <div>Currently:</div>
                            { currentTime.toString() }
                            <div>Sunrise</div>
                            { sunriseTime.toString() }
                            <div>Sunset</div>
                            { sunsetTime.toString() }
                            
                        </div>
                        <div className="halfway-calculator-input-title">
                            Start Time:
                        </div>
                        <input id="halfway-calculator-input" placeholder="1400" onChange={e => setStartTime(e.target.value)} type="text"/>
                    </div>
                    <div className='halfway-calculator-end'>
                        <div className='halfway-calculator-input-title'>
                            { sunsetTime.toString() }
                        </div>
                        <div className="halfway-calculator-input-title">
                            End Time:
                        </div>
                        <input id="halfway-calculator-input" placeholder="1950" onChange={e => setEndTime(e.target.value)} type="text"/>
                    </div>

                    <button id="ethanol-calculator-submit" onClick={handleSubmit}>Submit</button>
                    { halfwayTime }
                    
                </div>
            </div>

            <br/>
            <a href="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/Halfway" rel="noopener noreferrer"  target="_blank">
                <button id="halfway-sourcecode">View Source Code</button>
            </a>

        </div>
        <Footer/>
    </>)
}

export default Halfway