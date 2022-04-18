import React, { useEffect, useState } from 'react';
import Dropdown from "react-dropdown";
import "react-dropdown/style.css";

import "./Annuities.css";
import NewAnnuity from './NewAnnuity';
import GraphAnnuities from './GraphAnnuities';
import Footer from './../Footer/Footer';

// Initalize strings used for input collection and output
var inputString;
var tense = "";
var answer;


function Annuities() {

    const [answer, setAnswer] = useState(0);
    const [showNewAnnuity, setShowNewAnnuity] = useState(0);

    const [time, setTime] = useState('$Present');       // holds the chosen return tense
    const [annuityCall, setAnnuityCall] = useState([]); // holds the input variables from the input fields

    // clear results on tense change
    useEffect(() => {
        setAnswer(0);
    }, [time])


    // Parse input data + incorporate conversions into output variable(answer) -- do this every time a new annuity is submitted.
    useEffect(() => {
        let inputPresent=annuityCall[0];
        let inputAnnual=annuityCall[1];
        let inputFuture=annuityCall[2];
        let inputGradient=annuityCall[3];
        let inputInterest=annuityCall[4];
        let inputPeriods=annuityCall[5];

        //PTOF
        if(inputPresent&&(time==="$Future")){
            let ansr = (answer + (inputPresent * (Math.pow(1+inputInterest,inputPeriods))));
            setAnswer(ansr);
        }
        //ATOF
        if(inputAnnual&&(time==="$Future")){
            let ansr = (answer + (inputAnnual * (((Math.pow((1+inputInterest), inputPeriods))-1)/inputInterest)));
            setAnswer(ansr);
        }
        //GTOF
        if(inputGradient&&(time==="$Future")){
            let innL = (((Math.pow((1+inputInterest),inputPeriods)-1))/(inputInterest*inputInterest));
            let innR = (inputPeriods/inputInterest);
            let ansr = (answer + inputGradient*(innL-innR));
            setAnswer(ansr);
        }
        //FTOP
        if(inputFuture&&(time==="$Present")){
            let ansr = (answer + (inputFuture*(Math.pow(1/(1+inputInterest), inputPeriods))));
            setAnswer(ansr);
        }
        //ATOP
        if(inputAnnual&&(time==="$Present")){
            let ansr = (answer + (inputAnnual * (((Math.pow((1+inputInterest),inputPeriods))-1)/(inputInterest*(Math.pow((1+inputInterest),inputPeriods))))));
            setAnswer(ansr);
        }
        //GTOP
        if(inputGradient&&(time==="$Present")){
            let inL = ((Math.pow((1+inputInterest),inputPeriods)-1)/(inputInterest*(Math.pow((1+inputInterest),inputPeriods))));
            let inR = inputPeriods/(Math.pow((1+inputInterest),inputPeriods));
            let ansr = (inputGradient * (1/inputInterest)*(inL - inR));
            setAnswer(ansr);
        }
        //FTOA
        if(inputFuture&&(time==="$Periodic")){
            let ansr = (answer + (inputFuture * ((inputInterest)/(Math.pow((1+inputInterest),inputPeriods)-1))));
            setAnswer(ansr);
        }
        //PTOA
        if(inputPresent&&(time==="$Periodic")){
            let upr = inputPresent*(inputInterest*(Math.pow((1+inputInterest),inputPeriods)));
            let lwr = (Math.pow((1+inputInterest), inputPeriods)-1);
            let ansr = (answer + (upr/lwr));
            setAnswer(ansr);
        }
        //GTOA
        if(inputGradient&&(time==="$Periodic")){
            let ansr = (answer + (inputGradient * ((1/inputInterest)-(inputPeriods/(Math.pow((1+inputInterest),inputPeriods)-1)))));
            setAnswer(ansr);
        }

    }, [annuityCall]);

    const options = [
        '$Present', '$Periodic', '$Future',
    ];

    const defaultOption = options[0];

    return (<div className='annuities'>
        <div className='annuities-title'>
            Annuities
        </div>
        <div className='annuities-subtitle'>
            Financial Annuity Calculator
        </div>
        <div className='annuities-inputs'>
            <div className='annuities-find-text'>
                Find:
            </div>
            <div className='annuities-find-dropdown'>
                <Dropdown 
                    options={options} 
                    onChange={(e) => setTime(e.value)} 
                    value={defaultOption} 
                    placeholder="Select an option" 
                />
            </div>
            <button 
                onClick={()=>setShowNewAnnuity(showNewAnnuity+1)} 
                id='newAnnuity' 
                type='button'
                >
                Toggle New Visability
            </button>
        </div>

        <div className='annuities-newannuity'>
            {(showNewAnnuity%2)?
                <NewAnnuity 
                tenseAnnuity={time} 
                onNewAnnuity={setAnnuityCall}  
                />:null
            }
        </div>

        <div className='annuities-output'>
            <span className='annuities-output-span'>
                graph of money over time - broken atm
                <GraphAnnuities chartData={annuityCall}   />
            </span>
            
        </div>

        <div className='annuities-resulttime'>
            <div className='annuities-resulttime-text'>
                The {time.substring(1)} Value would be ${answer.toFixed(2)}.
            </div>
        </div>


        <div className='annuities-description'>
            This calculator supports the following annuity conversions:
            <br></br> 
            <br></br>
            (PtoA) - (CR) Capital Recovery (present to periodic value)
            <br></br>
            (PtoF) - (SPCA) Single Payment Compound Amount (present to future value)
            <br></br>
            (FtoP) - (SPPW) Single payment present worth (future to present value)
            <br></br>
            (GtoF) - (UGFW) Uniform gradient future worth (gradient to future value)
            <br></br>
            (GtoP) - (UGPW) Uniform gradient present worth (gradient to present value)
            <br></br>
            (GtoA) - (UGUS) Uniform gradient uniform series (gradient to periodic value)
            <br></br>
            (AtoF) - (USCA) Uniform series compound Amount (periodic to future value)
            <br></br>
            (AtoP) - (USPW) Uniform series present worth (periodic to present value)
            <br></br>
            (FtoA) - (USSF) Uniform series sinking fund (future to periodic value)
            <br></br>

        </div>
        <Footer/>
    </div>);
};

export default Annuities;