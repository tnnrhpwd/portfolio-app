import React, { useState } from 'react';
import Footer from '../Footer/Footer';
import NavBar from './../NavBar/NavBar';
import './Halfway.css';

function Halfway() {
    const [endTime, setEndTime] = useState(0);
    const [startTime, setStartTime] = useState(0);
    const [halfwayTime, setHalfwayTime] = useState(0);

    function handleSubmit(){
        // GUARD CLAUSE --
        if((endTime===startTime)){ return; }

        let answer = parseInt((endTime-startTime)/2)+parseFloat(startTime)

        setHalfwayTime(answer);
    }

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
                        <div className="halfway-calculator-input-title">
                            Start Time:
                        </div>
                        <input id="halfway-calculator-input" placeholder="1400" onChange={e => setStartTime(e.target.value)} type="text"/>
                    </div>
                    <div className='halfway-calculator-end'>
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
            <a href="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/Halfway" rel="noreferrer"  target="_blank">
                <button id="halfway-sourcecode">View Source Code</button>
            </a>

        </div>
        <Footer/>
    </>)
}

export default Halfway