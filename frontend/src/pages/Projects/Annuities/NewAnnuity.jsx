import React, { useEffect, useState } from "react";

function NewAnnuity({ tenseAnnuity, onNewAnnuity }) {
    const [values, setValues] = useState({
        presentVal: "",
        annualVal: "",
        futureVal: "",
        gradientVal: "",
        intVal: "",
        nVal: ""
    });

    useEffect(() => {
        const annuit = Object.values(values).map(val => parseFloat(val));
        onNewAnnuity(annuit);
    }, [values, onNewAnnuity]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setValues(prevValues => ({ ...prevValues, [name]: value }));
    };

    const handleReset = () => {
        setValues({
            presentVal: "",
            annualVal: "",
            futureVal: "",
            gradientVal: "",
            intVal: "",
            nVal: ""
        });
    };

    const handleKeyDown = (event) => {
        if (event.key === 'Enter') {
            onNewAnnuity(Object.values(values).map(val => parseFloat(val)));
        }
    };

    return (
        <>
            <div className="inputNewAnnuity">
                {tenseAnnuity !== '$Present' && (
                    <input
                        name="presentVal"
                        value={values.presentVal}
                        placeholder="Present Value"
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        className="inputNewAnnuity-present"
                    />
                )}
                {tenseAnnuity !== '$Periodic' && (
                    <input
                        name="annualVal"
                        value={values.annualVal}
                        placeholder="Periodic Value"
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        className="inputNewAnnuity-annual"
                    />
                )}
                {tenseAnnuity !== '$Future' && (
                    <input
                        name="futureVal"
                        value={values.futureVal}
                        placeholder="Future Value"
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        className="inputNewAnnuity-future"
                    />
                )}
                <input
                    name="gradientVal"
                    value={values.gradientVal}
                    placeholder="Gradient Value"
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    className="inputNewAnnuity-gradient"
                />
                <input
                    name="intVal"
                    value={values.intVal}
                    placeholder="Interest Rate"
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    className="inputNewAnnuity-interest"
                />
                <input
                    name="nVal"
                    value={values.nVal}
                    placeholder="Number of Periods"
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    className="inputNewAnnuity-periods"
                />
            </div>
            <button onClick={() => onNewAnnuity(Object.values(values).map(val => parseFloat(val)))} id="submitNewAnnuity">
                Submit Annuity
            </button>
            <button onClick={handleReset} id="resetNewAnnuity">
                Reset
            </button>
        </>
    );
}

export default NewAnnuity;