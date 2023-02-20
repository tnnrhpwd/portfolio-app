import React, { useEffect, useState } from "react";

function NewAnnuity(props) {

   // output value array
    var annuit=[];

    // store chosen tense from parent component
    var chosenTense = props.tenseAnnuity;

    //holds the value of present value as typed
    const [presentVal, setPresentValue] = useState("");
    const [annualVal, setAnnualValue] = useState("");
    const [futureVal, setFutureValue] = useState("");
    const [gradientVal, setGradientValue] = useState("");
    const [intVal, setIntValue] = useState("");
    const [nVal, setNValValue] = useState("");


    // builds output value to output
    useEffect(() => {

        annuit[0]=parseFloat(presentVal);
        annuit[1]=parseFloat(annualVal);
        annuit[2]=parseFloat(futureVal);
        annuit[3]=parseFloat(gradientVal);
        annuit[4]=parseFloat(intVal);
        annuit[5]=parseFloat(nVal);
    }, [presentVal,annualVal,futureVal,gradientVal,intVal,nVal,annuit]);


    // sends a value to parent
    var handleAnnuityCall = () => {
        props.onNewAnnuity(annuit);
    }

    // resets the input fields
    var handleAnnuityReset = () => {
        setPresentValue("");
        setAnnualValue("");
        setFutureValue("");
        setGradientValue("");
        setIntValue("");
        setNValValue("");
    }

    const handleKeyDown = (event) =>{
        if (event.key === 'Enter') {
            handleAnnuityCall();
        }

    }


    return(<>
        <div className="inputNewAnnuity">
            {(!(chosenTense==='$Present')) && <input value={presentVal} placeholder="Present Value" onChange={e => setPresentValue(e.target.value)} onKeyDown={handleKeyDown} className="inputNewAnnuity-present" />}

            {(!(chosenTense==='$Periodic')) && <input value={annualVal} placeholder="Periodic Value" onChange={e => setAnnualValue(e.target.value)} onKeyDown={handleKeyDown} className="inputNewAnnuity-annual" />}

            {(!(chosenTense==='$Future')) && <input value={futureVal} placeholder="Future Value" onChange={e => setFutureValue(e.target.value)} onKeyDown={handleKeyDown} className="inputNewAnnuity-future" />}

            <input value={gradientVal} placeholder="Gradient Value" onChange={e => setGradientValue(e.target.value)} onKeyDown={handleKeyDown} className="inputNewAnnuity-gradient" />

            <input value={intVal} placeholder="Interest Rate" onChange={e => setIntValue(e.target.value)} onKeyDown={handleKeyDown} className="inputNewAnnuity-interest" />

            <input value={nVal} placeholder="Number of Periods" onChange={e => setNValValue(e.target.value)} onKeyDown={handleKeyDown} className="inputNewAnnuity-periods" />
        </div>
        <button onClick={handleAnnuityCall} id="submitNewAnnuity" >
            Submit Annuity
        </button>
        <button onClick={handleAnnuityReset} id="submitNewAnnuity" >
            Reset
        </button>
    </>);
}

export default NewAnnuity;