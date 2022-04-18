import React, { useEffect, useState } from "react";

function NewAnnuity(props) {

    // output value array
    var annuit = [];

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
        annuit[0]=presentVal;
        annuit[1]=annualVal;
        annuit[2]=futureVal;
        annuit[3]=gradientVal;
        annuit[4]=intVal;
        annuit[5]=nVal;
    }, [presentVal+annualVal+futureVal+gradientVal+intVal+nVal]);


    // sends a value to parent
    var handleAnnuityCall = () => {
        props.onNewAnnuity(annuit);
        setPresentValue("");
        setAnnualValue("");
        setFutureValue("");
        setGradientValue("");
        setIntValue("");
        setNValValue("");
    }


    return(<>
        <div className="inputNewAnnuity">
            {(!(chosenTense=='$Present'))? <input value={presentVal} placeholder="Present Value" onChange={e => setPresentValue(e.target.value)} className="inputNewAnnuity-present" /> :null}
            <div></div>
            {(!(chosenTense=='$Periodic'))? <input value={annualVal} placeholder="Periodic Value" onChange={e => setAnnualValue(e.target.value)} className="inputNewAnnuity-annual" /> :null}
            <div></div>
            {(!(chosenTense=='$Future'))? <input value={futureVal} placeholder="Future Value" onChange={e => setFutureValue(e.target.value)} className="inputNewAnnuity-future" /> :null}
            <div></div>
            <input value={gradientVal} placeholder="Gradient Value" onChange={e => setGradientValue(e.target.value)} className="inputNewAnnuity-gradient" />
            <div></div>
            <input value={intVal} placeholder="Interest Rate" onChange={e => setIntValue(e.target.value)} className="inputNewAnnuity-interest" />
            <div></div>
            <input value={nVal} placeholder="Number of Periods" onChange={e => setNValValue(e.target.value)} className="inputNewAnnuity-periods" />
        </div>
        <button onClick={handleAnnuityCall} id="submitNewAnnuity" >
            Submit Annuity
        </button>
    </>);
}

export default NewAnnuity;