import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { updateData, getData, resetDataSlice, deleteData } from '../../../features/data/dataSlice.js';
import { toast } from 'react-toastify';
import Dropdown from "react-dropdown";
import "react-dropdown/style.css";
import NewAnnuity from './NewAnnuity';
import GraphAnnuities from './GraphAnnuities';
import Footer from '../../../components/Footer/Footer';
import "./Annuities.css";
import Header from '../../../components/Header/Header';

function Annuities() {
    const rootStyle = window.getComputedStyle(document.body);
    const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);

    const dispatch = useDispatch();
    const [powerMode, setPowerMode] = useState(false);

    // Get the relevant data from the state
    const { user, data, dataIsSuccess, dataIsLoading, dataIsError, dataMessage, operation } = useSelector(
        (state) => state.data
    );

    useEffect(() => {  // Additional useEffect for fetching data on component mount
        async function getMyData() {
          try {
            if (!user || user === null) { //guard clause: no user
                setPowerMode(false)
                return;
            }
            if (!user._id || user._id === '64efe9e2c42368e193ee6977') { // guard clause: guest user
                setPowerMode(false);
                return;
            }setPowerMode(true)
            toast.success('Power user active.', {autoClose: toastDuration});
            await dispatch(getData({ data: "Net:" }));
          } catch (error) {
            console.error(error);
            toast.error(error, { autoClose: toastDuration });    
          }
        }
        if (!dataIsSuccess){
            getMyData();
        }
    
        // Reset the data slice when the component unmounts
        return () => {
          dispatch(resetDataSlice());
        };
    }, [dispatch]);

    var crntAnswer=0;

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
        // crntAnswer = answer;
        let inputPresent=annuityCall[0];
        let inputAnnual=annuityCall[1];
        let inputFuture=annuityCall[2];
        let inputGradient=annuityCall[3];
        let inputInterest=annuityCall[4];
        let inputPeriods=annuityCall[5];

        //PTOF
        if(inputPresent&&(time==="$Future")){
            let ansr = (crntAnswer + (inputPresent * (Math.pow(1+inputInterest,inputPeriods))));
            crntAnswer= ansr;
        }
        //ATOF
        if(inputAnnual&&(time==="$Future")){
            let ansr = (crntAnswer + (inputAnnual * (((Math.pow((1+inputInterest), inputPeriods))-1)/inputInterest)));
            crntAnswer= ansr;
        }
        //GTOF
        if(inputGradient&&(time==="$Future")){
            let innL = (((Math.pow((1+inputInterest),inputPeriods)-1))/(inputInterest*inputInterest));
            let innR = (inputPeriods/inputInterest);
            let ansr = (crntAnswer + inputGradient*(innL-innR));
            crntAnswer= ansr;
        }
        //FTOP
        if(inputFuture&&(time==="$Present")){
            let ansr = (crntAnswer + (inputFuture*(Math.pow(1/(1+inputInterest), inputPeriods))));
            crntAnswer= ansr;
        }
        //ATOP
        if(inputAnnual&&(time==="$Present")){
            let ansr = (crntAnswer + (inputAnnual * (((Math.pow((1+inputInterest),inputPeriods))-1)/(inputInterest*(Math.pow((1+inputInterest),inputPeriods))))));
            crntAnswer= ansr;
        }
        //GTOP
        if(inputGradient&&(time==="$Present")){
            let inL = ((Math.pow((1+inputInterest),inputPeriods)-1)/(inputInterest*(Math.pow((1+inputInterest),inputPeriods))));
            let inR = inputPeriods/(Math.pow((1+inputInterest),inputPeriods));
            let ansr = (crntAnswer + (inputGradient * (1/inputInterest)*(inL - inR)));
            crntAnswer= ansr;
        }
        //FTOA
        if(inputFuture&&(time==="$Periodic")){
            let ansr = (crntAnswer + (inputFuture * ((inputInterest)/(Math.pow((1+inputInterest),inputPeriods)-1))));
            crntAnswer= ansr;
        }
        //PTOA
        if(inputPresent&&(time==="$Periodic")){
            let upr = inputPresent*(inputInterest*(Math.pow((1+inputInterest),inputPeriods)));
            let lwr = (Math.pow((1+inputInterest), inputPeriods)-1);
            let ansr = (crntAnswer + (upr/lwr));
            crntAnswer= ansr;
        }
        //GTOA
        if(inputGradient&&(time==="$Periodic")){
            let ansr = (crntAnswer + (inputGradient * ((1/inputInterest)-(inputPeriods/(Math.pow((1+inputInterest),inputPeriods)-1)))));
            crntAnswer= ansr;
        }
        setAnswer(crntAnswer);
    }, [annuityCall]);

    const options = [
        '$Present', '$Periodic', '$Future',
    ];

    const defaultOption = options[0];

    return (
    <>  
        <Header/>
            <div className='annuities'>
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
                        id="annuities-find-dropdown-id"
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
                {(showNewAnnuity%2===0) &&
                    <NewAnnuity 
                    tenseAnnuity={time} 
                    onNewAnnuity={setAnnuityCall}  
                    />
                }
            </div>

            {/* {!(answer===0)&&
                <div className='annuities-output'>
                    <span className='annuities-output-span'>
                        <GraphAnnuities chartValue={answer} chartData={annuityCall}   />
                    </span>
                </div>
            }   */}

            <div className='annuities-resulttime'>
                <div className='annuities-resulttime-text'>
                    The {time.substring(1)} Value would be ${answer.toFixed(2)}.
                </div>
            </div>


            <div className='annuities-description'>
                Example: If you have $500 and save $10 at 10% interest for 10 periods: Select $Future then enter 500 (present), 10 (periodic), 0.10 (interest), and 10 (periods).
                <br></br>
                <br></br> 
                <br></br> 
                This calculator supports the following annuity conversions:
                <br></br> 
                <br></br>
                (PtoA) - (CR) Capital Recovery
                <br></br>
                (PtoF) - (SPCA) Single Payment Compound Amount
                <br></br>
                (FtoP) - (SPPW) Single payment present worth
                <br></br>
                (GtoF) - (UGFW) Uniform gradient future worth
                <br></br>
                (GtoP) - (UGPW) Uniform gradient present worth
                <br></br>
                (GtoA) - (UGUS) Uniform gradient uniform series
                <br></br>
                (AtoF) - (USCA) Uniform series compound Amount
                <br></br>
                (AtoP) - (USPW) Uniform series present worth
                <br></br>
                (FtoA) - (USSF) Uniform series sinking fund
                <br></br>

            </div>
            <a href="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/Annuities" rel="noopener noreferrer"  target="_blank">
                <button id="newAnnuity">View Source Code</button>
            </a>
            <Footer/>
        </div>
    </>);
};

export default Annuities;