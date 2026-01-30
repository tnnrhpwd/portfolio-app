import React, { useEffect, useState } from "react";
import "./NewAnnuity.css";

function NewAnnuity({ tenseAnnuity, onNewAnnuity, initialValues }) {
    const [values, setValues] = useState({
        presentVal: "",
        annualVal: "",
        futureVal: "",
        gradientVal: "",
        intVal: "",
        nVal: ""
    });

    // Add state for tracking focus
    const [focusedField, setFocusedField] = useState(null);

    // Update values when initialValues prop changes (for example problems)
    useEffect(() => {
        if (initialValues) {
            setValues({
                presentVal: initialValues.presentVal?.toString() || "",
                annualVal: initialValues.annualVal?.toString() || "",
                futureVal: initialValues.futureVal?.toString() || "",
                gradientVal: initialValues.gradientVal?.toString() || "",
                intVal: initialValues.intVal?.toString() || "",
                nVal: initialValues.nVal?.toString() || ""
            });
        } else if (initialValues === null) {
            // Clear all values when initialValues is explicitly null
            setValues({
                presentVal: "",
                annualVal: "",
                futureVal: "",
                gradientVal: "",
                intVal: "",
                nVal: ""
            });
        }
    }, [initialValues]);

    useEffect(() => {
        // Immediately notify parent of value changes for real-time updates
        const annuit = Object.values(values).map(val => parseFloat(val) || 0);
        onNewAnnuity(annuit);
    }, [values, onNewAnnuity]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        // Allow only digits and decimal point
        const numericValue = value.replace(/[^0-9.]/g, '');
        setValues(prevValues => ({ ...prevValues, [name]: numericValue }));
    };

    const handleKeyDown = (event) => {
        if (event.key === 'Enter') {
            onNewAnnuity(Object.values(values).map(val => parseFloat(val) || 0));
        }
    };

    // Define input metadata with more helpful information
    const inputMeta = {
        presentVal: {
            label: "Present Value ($P)",
            placeholder: "Present Value ($)",
            symbol: "$P",
            description: "Initial investment amount"
        },
        annualVal: {
            label: "Periodic Value ($A)",
            placeholder: "Periodic Value ($)",
            symbol: "$A",
            description: "Regular payment amount"
        },
        futureVal: {
            label: "Future Value ($F)",
            placeholder: "Future Value ($)",
            symbol: "$F",
            description: "Target amount"
        },
        gradientVal: {
            label: "Gradient Value ($G)",
            placeholder: "Gradient Value ($)",
            symbol: "$G",
            description: "Periodic increase"
        },
        intVal: {
            label: "Interest Rate (i)",
            placeholder: "e.g., 0.05 for 5%",
            symbol: "i",
            description: "Annual interest rate"
        },
        nVal: {
            label: "Number of Periods (n)",
            placeholder: "e.g., 10 years",
            symbol: "n",
            description: "Time duration"
        }
    };

    return (
        <div className="annuity-input-container">
            <div className="inputNewAnnuity">
                {tenseAnnuity !== '$Present' && (
                    <div className={`input-group ${values.presentVal ? 'has-value' : ''} ${focusedField === 'presentVal' ? 'focused' : ''}`}>
                        <div className="input-label-container">
                            <label htmlFor="presentVal">{inputMeta.presentVal.label}:</label>
                            <span className="input-symbol">{inputMeta.presentVal.symbol}</span>
                        </div>
                        <input
                            id="presentVal"
                            name="presentVal"
                            value={values.presentVal}
                            placeholder={inputMeta.presentVal.placeholder}
                            onChange={handleChange}
                            onKeyDown={handleKeyDown}
                            onFocus={() => setFocusedField('presentVal')}
                            onBlur={() => setFocusedField(null)}
                            className="inputNewAnnuity-present"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                        />
                        {values.presentVal && <div className="input-value-indicator">Present: ${parseFloat(values.presentVal).toLocaleString()}</div>}
                        <span className="input-description">{inputMeta.presentVal.description}</span>
                    </div>
                )}
                {tenseAnnuity !== '$Periodic' && (
                    <div className={`input-group ${values.annualVal ? 'has-value' : ''} ${focusedField === 'annualVal' ? 'focused' : ''}`}>
                        <div className="input-label-container">
                            <label htmlFor="annualVal">{inputMeta.annualVal.label}:</label>
                            <span className="input-symbol">{inputMeta.annualVal.symbol}</span>
                        </div>
                        <input
                            id="annualVal"
                            name="annualVal"
                            value={values.annualVal}
                            placeholder={inputMeta.annualVal.placeholder}
                            onChange={handleChange}
                            onKeyDown={handleKeyDown}
                            onFocus={() => setFocusedField('annualVal')}
                            onBlur={() => setFocusedField(null)}
                            className="inputNewAnnuity-annual"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                        />
                        {values.annualVal && <div className="input-value-indicator">Periodic: ${parseFloat(values.annualVal).toLocaleString()}</div>}
                        <span className="input-description">{inputMeta.annualVal.description}</span>
                    </div>
                )}
                {tenseAnnuity !== '$Future' && (
                    <div className={`input-group ${values.futureVal ? 'has-value' : ''} ${focusedField === 'futureVal' ? 'focused' : ''}`}>
                        <div className="input-label-container">
                            <label htmlFor="futureVal">{inputMeta.futureVal.label}:</label>
                            <span className="input-symbol">{inputMeta.futureVal.symbol}</span>
                        </div>
                        <input
                            id="futureVal"
                            name="futureVal"
                            value={values.futureVal}
                            placeholder={inputMeta.futureVal.placeholder}
                            onChange={handleChange}
                            onKeyDown={handleKeyDown}
                            onFocus={() => setFocusedField('futureVal')}
                            onBlur={() => setFocusedField(null)}
                            className="inputNewAnnuity-future"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                        />
                        {values.futureVal && <div className="input-value-indicator">Future: ${parseFloat(values.futureVal).toLocaleString()}</div>}
                        <span className="input-description">{inputMeta.futureVal.description}</span>
                    </div>
                )}
                <div className={`input-group ${values.gradientVal ? 'has-value' : ''} ${focusedField === 'gradientVal' ? 'focused' : ''}`}>
                    <div className="input-label-container">
                        <label htmlFor="gradientVal">{inputMeta.gradientVal.label}:</label>
                        <span className="input-symbol">{inputMeta.gradientVal.symbol}</span>
                    </div>
                    <input
                        id="gradientVal"
                        name="gradientVal"
                        value={values.gradientVal}
                        placeholder={inputMeta.gradientVal.placeholder}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        onFocus={() => setFocusedField('gradientVal')}
                        onBlur={() => setFocusedField(null)}
                        className="inputNewAnnuity-gradient"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                    />
                    {values.gradientVal && <div className="input-value-indicator">Gradient: ${parseFloat(values.gradientVal).toLocaleString()}</div>}
                    <span className="input-description">{inputMeta.gradientVal.description}</span>
                </div>
                <div className={`input-group ${values.intVal ? 'has-value' : ''} ${focusedField === 'intVal' ? 'focused' : ''}`}>
                    <div className="input-label-container">
                        <label htmlFor="intVal">{inputMeta.intVal.label}:</label>
                        <span className="input-symbol">{inputMeta.intVal.symbol}</span>
                    </div>
                    <input
                        id="intVal"
                        name="intVal"
                        value={values.intVal}
                        placeholder={inputMeta.intVal.placeholder}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        onFocus={() => setFocusedField('intVal')}
                        onBlur={() => setFocusedField(null)}
                        className="inputNewAnnuity-interest"
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*\.?[0-9]*"
                    />
                    {values.intVal && <div className="input-value-indicator">Rate: {(parseFloat(values.intVal) * 100).toFixed(2)}%</div>}
                    <span className="input-description">{inputMeta.intVal.description}</span>
                </div>
                <div className={`input-group ${values.nVal ? 'has-value' : ''} ${focusedField === 'nVal' ? 'focused' : ''}`}>
                    <div className="input-label-container">
                        <label htmlFor="nVal">{inputMeta.nVal.label}:</label>
                        <span className="input-symbol">{inputMeta.nVal.symbol}</span>
                    </div>
                    <input
                        id="nVal"
                        name="nVal"
                        value={values.nVal}
                        placeholder={inputMeta.nVal.placeholder}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        onFocus={() => setFocusedField('nVal')}
                        onBlur={() => setFocusedField(null)}
                        className="inputNewAnnuity-periods"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                    />
                    {values.nVal && <div className="input-value-indicator">Periods: {parseInt(values.nVal)}</div>}
                    <span className="input-description">{inputMeta.nVal.description}</span>
                </div>
            </div>
        </div>
    );
}

export default NewAnnuity;