import React, { useEffect, useState } from "react";
import "./NewAnnuity.css";

function NewAnnuity({ tenseAnnuity, onNewAnnuity }) {
    const [presentVal, setPresentValue] = useState("");
    const [annualVal, setAnnualValue] = useState("");
    const [futureVal, setFutureValue] = useState("");
    const [gradientVal, setGradientValue] = useState("");
    const [intVal, setIntValue] = useState("");
    const [nVal, setNValValue] = useState("");

    useEffect(() => {
        const annuit = [
            parseFloat(presentVal) || 0,
            parseFloat(annualVal) || 0,
            parseFloat(futureVal) || 0,
            parseFloat(gradientVal) || 0,
            parseFloat(intVal) || 0,
            parseFloat(nVal) || 0
        ];
        onNewAnnuity(annuit);
    }, [presentVal, annualVal, futureVal, gradientVal, intVal, nVal, onNewAnnuity]);

    const handleKeyDown = (event) => {
        if (event.key === 'Enter') {
            onNewAnnuity([
                parseFloat(presentVal) || 0,
                parseFloat(annualVal) || 0,
                parseFloat(futureVal) || 0,
                parseFloat(gradientVal) || 0,
                parseFloat(intVal) || 0,
                parseFloat(nVal) || 0
            ]);
        }
    };

    return (
        <div className="new-annuity">
            {tenseAnnuity !== '$Present' && (
                <input
                    value={presentVal}
                    placeholder="Present Value"
                    onChange={(e) => setPresentValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="new-annuity-input"
                />
            )}
            {tenseAnnuity !== '$Periodic' && (
                <input
                    value={annualVal}
                    placeholder="Periodic Value"
                    onChange={(e) => setAnnualValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="new-annuity-input"
                />
            )}
            {tenseAnnuity !== '$Future' && (
                <input
                    value={futureVal}
                    placeholder="Future Value"
                    onChange={(e) => setFutureValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="new-annuity-input"
                />
            )}
            <input
                value={gradientVal}
                placeholder="Gradient Value"
                onChange={(e) => setGradientValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="new-annuity-input"
            />
            <input
                value={intVal}
                placeholder="Interest Rate"
                onChange={(e) => setIntValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="new-annuity-input"
            />
            <input
                value={nVal}
                placeholder="Number of Periods"
                onChange={(e) => setNValValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="new-annuity-input"
            />
        </div>
    );
}

export default NewAnnuity;