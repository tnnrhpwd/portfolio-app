import React, { useState } from 'react';
import Footer from '../Footer/Footer';
import NavBar from './../NavBar/NavBar';
import './Halfway.css';

function Halfway() {
    const [destinationTime, setDestinationTime] = useState("");

    return (<>
        <NavBar/>
        <div className='halfway'>
            <div className="halfway-title">
                Halfway
            </div>
            <div className="halfway-description">
                This calculator estimates the halfway time of any trip. 
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