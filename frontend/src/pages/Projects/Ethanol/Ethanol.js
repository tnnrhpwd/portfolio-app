import React, { useState, useEffect } from "react";
import Footer from '../../../components/Footer/Footer';
import Header from '../../../components/Header/Header';
import EthanolVisual from "./EthanolVisual.js";
import SEO from '../../../components/SEO/SEO.jsx';
import "./Ethanol.css";

const ETHANOL_DENSITY = 0.78945; // grams / milliliter
const FLOZ_TO_ML = 29.57353;
const US_STANDARD_GRAMS = 14;
const LOG_STORAGE_KEY = 'ethanol-drink-log';

const NIAAA_IMG = "https://www.niaaa.nih.gov/sites/default/files/What_Is_a_Standard_Drink_grayscale_508_Release_Web.jpg";
const NIAAA_LINK = "https://www.niaaa.nih.gov/alcohols-effects-health/overview-alcohol-consumption/what-standard-drink";
const STANDARD_LINK = "https://en.wikipedia.org/wiki/Standard_drink";

// Approximate ABV% and typical serving size for common beverage types.
const BEVERAGE_PRESETS = [
    { key: 'beer', label: 'Beer', icon: '🍺', abv: 5, volumeMl: 355 },
    { key: 'wine', label: 'Wine', icon: '🍷', abv: 12, volumeMl: 148 },
    { key: 'fortified', label: 'Fortified Wine', icon: '🍶', abv: 18, volumeMl: 89 },
    { key: 'spirits', label: 'Spirits (shot)', icon: '🥃', abv: 40, volumeMl: 44 },
];

function loadLog() {
    try {
        const saved = localStorage.getItem(LOG_STORAGE_KEY);
        return saved ? JSON.parse(saved) : [];
    } catch {
        return [];
    }
}

function Ethanol() {
    const [volumeInput, setVolumeInput] = useState("");
    const [volumeUnits, setVolumeUnits] = useState("Milliliters");
    const [percentInput, setPercentInput] = useState("");
    const [standardGrams, setStandardGrams] = useState(US_STANDARD_GRAMS);
    const [selectedPreset, setSelectedPreset] = useState(null);
    const [output, setOutput] = useState("");
    const [ethanolGrams, setEthanolGrams] = useState("");
    const [error, setError] = useState("");
    const [log, setLog] = useState(loadLog);

    useEffect(() => {
        try {
            localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(log));
        } catch {
            // localStorage may be unavailable (e.g. private browsing) - ignore
        }
    }, [log]);

    function applyPreset(preset) {
        setSelectedPreset(preset.key);
        setPercentInput(String(preset.abv));
        setVolumeInput(String(preset.volumeMl));
        setVolumeUnits("Milliliters");
        setError("");
    }

    function handleVolumeChange(e) {
        setVolumeInput(e.target.value);
        setSelectedPreset(null);
    }

    function handlePercentChange(e) {
        setPercentInput(e.target.value);
        setSelectedPreset(null);
    }

    function handleKeyPress(e) {
        if (e.key === "Enter") { handleCalculate(); }
    }

    function handleCalculate() {
        const volumeRaw = parseFloat(volumeInput);
        const percent = parseFloat(percentInput);
        const grams = parseFloat(standardGrams);

        if (!volumeInput || isNaN(volumeRaw) || volumeRaw <= 0) {
            setError("Please enter a valid beverage volume greater than 0.");
            setOutput("");
            return;
        }
        if (!percentInput || isNaN(percent) || percent <= 0 || percent > 100) {
            setError("Please enter a valid alcohol percentage between 0 and 100.");
            setOutput("");
            return;
        }
        if (!standardGrams || isNaN(grams) || grams <= 0) {
            setError("Please enter a valid standard drink definition greater than 0.");
            setOutput("");
            return;
        }

        const volumeMl = volumeUnits === "Milliliters" ? volumeRaw : volumeRaw * FLOZ_TO_ML;
        const gramsOfEthanol = volumeMl * (percent / 100) * ETHANOL_DENSITY;
        const standardDrinks = gramsOfEthanol / grams;

        setError("");
        setEthanolGrams(gramsOfEthanol.toFixed(1));
        setOutput(standardDrinks.toFixed(2));
    }

    function handleReset() {
        setVolumeInput("");
        setPercentInput("");
        setStandardGrams(US_STANDARD_GRAMS);
        setVolumeUnits("Milliliters");
        setSelectedPreset(null);
        setOutput("");
        setEthanolGrams("");
        setError("");
    }

    function handleAddToLog() {
        if (!output || error) { return; }
        const preset = BEVERAGE_PRESETS.find(p => p.key === selectedPreset);
        const entry = {
            id: Date.now(),
            label: preset ? preset.label : "Custom",
            volume: volumeInput,
            unitShort: volumeUnits === "Milliliters" ? "mL" : "fl oz",
            percent: percentInput,
            drinks: output,
            grams: ethanolGrams,
            at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setLog(prev => [...prev, entry]);
    }

    function handleRemoveLogEntry(id) {
        setLog(prev => prev.filter(entry => entry.id !== id));
    }

    function handleClearLog() {
        setLog([]);
    }

    const totalDrinks = log.reduce((sum, entry) => sum + (parseFloat(entry.drinks) || 0), 0);
    const totalGrams = log.reduce((sum, entry) => sum + (parseFloat(entry.grams) || 0), 0);

    return (<>
        <SEO
            title="Ethanol Calculator"
            description="Calculate standard alcoholic drink equivalents from volume and percent alcohol, and track your drinks with a built-in log."
            path="/ethanol"
        />
        <Header />
        <div className="ethanol">
            <div className="ethanol-floating" aria-hidden="true">
                <div className="ethanol-circle ethanol-circle-1" />
                <div className="ethanol-circle ethanol-circle-2" />
                <div className="ethanol-circle ethanol-circle-3" />
            </div>

            <section className="ethanol-section">
                <div className="ethanol-title-wrap">
                    <h1 className="ethanol-title">Ethanol Calculator</h1>
                    <div className="ethanol-underline" aria-hidden="true" />
                    <p className="ethanol-subtitle">
                        Estimate how many standard drinks are in any beverage, from a can of beer to a mixed cocktail. For educational and harm-reduction purposes only.
                    </p>
                </div>

                <div className="ethanol-card">
                    <h2>1. Pick a Beverage Type</h2>
                    <div className="ethanol-preset-row" role="radiogroup" aria-label="Beverage type">
                        {BEVERAGE_PRESETS.map(preset => (
                            <button
                                key={preset.key}
                                type="button"
                                className={`ethanol-preset-btn${selectedPreset === preset.key ? ' selected' : ''}`}
                                role="radio"
                                aria-checked={selectedPreset === preset.key}
                                onClick={() => applyPreset(preset)}
                            >
                                <span className="preset-icon">{preset.icon}</span>
                                <span className="preset-label">{preset.label}</span>
                                <span className="preset-abv">{preset.abv}% ABV</span>
                            </button>
                        ))}
                        <button
                            type="button"
                            className={`ethanol-preset-btn${selectedPreset === null ? ' selected' : ''}`}
                            role="radio"
                            aria-checked={selectedPreset === null}
                            onClick={() => setSelectedPreset(null)}
                        >
                            <span className="preset-icon">✏️</span>
                            <span className="preset-label">Custom</span>
                            <span className="preset-abv">Enter your own</span>
                        </button>
                    </div>
                </div>

                <div className="ethanol-card">
                    <h2>2. Enter the Details</h2>
                    <div className="ethanol-field">
                        <label htmlFor="ethanol-volume-input" className="ethanol-label">Beverage Volume</label>
                        <div className="ethanol-field-row">
                            <input
                                id="ethanol-volume-input"
                                className="ethanol-input"
                                placeholder="e.g. 355"
                                value={volumeInput}
                                onChange={handleVolumeChange}
                                onKeyDown={handleKeyPress}
                                type="number"
                                min="0"
                                inputMode="decimal"
                            />
                            <div className="ethanol-unit-toggle" role="radiogroup" aria-label="Volume unit">
                                <button type="button" className={`ethanol-unit-btn${volumeUnits === 'Milliliters' ? ' selected' : ''}`} onClick={() => setVolumeUnits('Milliliters')}>mL</button>
                                <button type="button" className={`ethanol-unit-btn${volumeUnits === 'Fluid Ounces' ? ' selected' : ''}`} onClick={() => setVolumeUnits('Fluid Ounces')}>fl oz</button>
                            </div>
                        </div>
                    </div>

                    <div className="ethanol-field">
                        <label htmlFor="ethanol-percent-input" className="ethanol-label">Alcohol Content (% ABV)</label>
                        <input
                            id="ethanol-percent-input"
                            className="ethanol-input"
                            placeholder="e.g. 5"
                            value={percentInput}
                            onChange={handlePercentChange}
                            onKeyDown={handleKeyPress}
                            type="number"
                            min="0"
                            max="100"
                            inputMode="decimal"
                        />
                    </div>

                    <div className="ethanol-field">
                        <label htmlFor="ethanol-standard-input" className="ethanol-label">
                            Standard Drink Definition (grams of ethanol)
                        </label>
                        <div className="ethanol-field-row">
                            <input
                                id="ethanol-standard-input"
                                className="ethanol-input ethanol-input-sm"
                                value={standardGrams}
                                onChange={e => setStandardGrams(e.target.value)}
                                onKeyDown={handleKeyPress}
                                type="number"
                                min="1"
                                inputMode="decimal"
                            />
                            <span className="ethanol-field-hint">grams / drink</span>
                            <a className="ethanol-inline-link" href={STANDARD_LINK} rel="noopener noreferrer" target="_blank">What&apos;s this?</a>
                        </div>
                        <p className="ethanol-field-hint-full">The U.S. standard is 14g. The U.K. uses 8g, Australia 10g, and Japan 19.75g.</p>
                    </div>

                    {error && <div className="ethanol-error">{error}</div>}

                    <div className="ethanol-btn-row">
                        <button className="ethanol-btn" type="button" onClick={handleCalculate}>Calculate</button>
                        <button className="ethanol-btn secondary" type="button" onClick={handleReset}>Reset</button>
                    </div>
                </div>

                {output !== "" && !error && (
                    <div className="ethanol-card ethanol-result-card">
                        <h2>Result</h2>
                        <div className="ethanol-result-grid">
                            <div className="ethanol-result-stat">
                                <span className="ethanol-result-value">{output}</span>
                                <span className="ethanol-result-label">Standard Drinks</span>
                            </div>
                            <div className="ethanol-result-stat">
                                <span className="ethanol-result-value">{ethanolGrams}g</span>
                                <span className="ethanol-result-label">Pure Ethanol</span>
                            </div>
                        </div>
                        <div className="ethanol-visual-wrap">
                            <EthanolVisual out={Number(output)} />
                        </div>
                        <button className="ethanol-btn secondary ethanol-log-btn" type="button" onClick={handleAddToLog}>
                            + Add to My Drink Log
                        </button>
                    </div>
                )}

                {log.length > 0 && (
                    <div className="ethanol-card">
                        <h2>My Drink Log</h2>
                        <div className="ethanol-log-summary">
                            <div><strong>{totalDrinks.toFixed(2)}</strong> standard drinks total</div>
                            <div><strong>{totalGrams.toFixed(1)}g</strong> pure ethanol total</div>
                        </div>
                        <ul className="ethanol-log-list">
                            {log.map(entry => (
                                <li key={entry.id} className="ethanol-log-item">
                                    <span className="ethanol-log-time">{entry.at}</span>
                                    <span className="ethanol-log-detail">{entry.label} · {entry.volume}{entry.unitShort} · {entry.percent}%</span>
                                    <span className="ethanol-log-drinks">{entry.drinks} drinks</span>
                                    <button className="ethanol-log-remove" type="button" aria-label="Remove entry" onClick={() => handleRemoveLogEntry(entry.id)}>✕</button>
                                </li>
                            ))}
                        </ul>
                        <button className="ethanol-btn secondary" type="button" onClick={handleClearLog}>Clear Log</button>
                        <p className="ethanol-disclaimer">
                            Your log is stored only on this device and never leaves your browser. This is not a medical tool — if you have concerns about your drinking, please consult a healthcare professional.
                        </p>
                    </div>
                )}

                <div className="ethanol-info-grid">
                    <div className="ethanol-card ethanol-info-card">
                        <h2>What Counts as a Standard Drink?</h2>
                        <img className="ethanol-niaaa-img" src={NIAAA_IMG} alt="Standard drink sizes chart from NIAAA" />
                        <a className="ethanol-inline-link" href={NIAAA_LINK} rel="noopener noreferrer" target="_blank">
                            Learn more from the NIAAA →
                        </a>
                    </div>
                    <div className="ethanol-card ethanol-info-card">
                        <h2>How the Math Works</h2>
                        <p className="ethanol-formula-text">
                            Pure Ethanol (g) = Volume (mL) × (% ABV ÷ 100) × 0.789 g/mL
                        </p>
                        <p className="ethanol-formula-text">
                            Standard Drinks = Pure Ethanol (g) ÷ Grams per Standard Drink
                        </p>
                        <p className="ethanol-hint">
                            0.789 g/mL is the density of pure ethanol at room temperature. This calculator assumes the ABV printed on the label is accurate.
                        </p>
                    </div>
                </div>

                <p className="ethanol-disclaimer">
                    This calculator is for educational and harm-reduction purposes only. It does not account for individual factors like body weight, sex, food intake, or metabolism, and it cannot tell you if it is safe to drive. When in doubt, don&apos;t drink and drive.
                </p>

                <div className="ethanol-btn-row">
                    <a href="https://github.com/tnnrhpwd/portfolio-app/tree/master/frontend/src/pages/Projects/Ethanol" rel="noopener noreferrer" target="_blank">
                        <button className="ethanol-btn secondary" type="button">View Source Code</button>
                    </a>
                </div>
            </section>
        </div>
        <Footer />
    </>);
}

export default Ethanol;
