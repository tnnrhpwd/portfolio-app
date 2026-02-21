import React, { useEffect, useState, useCallback } from 'react';
import Dropdown from "react-dropdown";
import "react-dropdown/style.css";
import NewAnnuity from './NewAnnuity';
import GraphAnnuities from './GraphAnnuities';
import Footer from '../../../components/Footer/Footer';
import Header from '../../../components/Header/Header';
import "./Annuities.css";

// Engineering Economy Example Problems
const exampleProblems = [
    {
        id: 'retirement-savings',
        title: '🏦 Retirement Savings Plan',
        description: 'You invest $10,000 today and add $500/month for 30 years at 7% annual interest. What will you have at retirement?',
        difficulty: 'Beginner',
        concepts: ['P→F', 'A→F'],
        annuities: [
            {
                time: '$Future',
                values: { presentVal: 10000, annualVal: '', futureVal: '', gradientVal: '', intVal: 0.07, nVal: 30 }
            },
            {
                time: '$Future',
                values: { presentVal: '', annualVal: 6000, futureVal: '', gradientVal: '', intVal: 0.07, nVal: 30 }
            }
        ]
    },
    {
        id: 'car-loan',
        title: '🚗 Auto Loan Payment',
        description: 'Calculate monthly payments for a $25,000 car loan at 5.9% APR over 5 years.',
        difficulty: 'Beginner',
        concepts: ['P→A'],
        annuities: [
            {
                time: '$Periodic',
                values: { presentVal: 25000, annualVal: '', futureVal: '', gradientVal: '', intVal: 0.059, nVal: 5 }
            }
        ]
    },
    {
        id: 'equipment-replacement',
        title: '🏭 Equipment Replacement Analysis',
        description: 'A machine costs $50,000 now and will need $2,000/year maintenance increasing by $500/year. At 10% interest over 8 years, what is the present cost?',
        difficulty: 'Intermediate',
        concepts: ['A→P', 'G→P'],
        annuities: [
            {
                time: '$Present',
                values: { presentVal: '', annualVal: 2000, futureVal: '', gradientVal: '', intVal: 0.10, nVal: 8 }
            },
            {
                time: '$Present',
                values: { presentVal: '', annualVal: '', futureVal: '', gradientVal: 500, intVal: 0.10, nVal: 8 }
            }
        ]
    },
    {
        id: 'bond-valuation',
        title: '📈 Bond Present Value',
        description: 'A bond pays $1,000 annual coupon and $10,000 face value at maturity in 10 years. At 8% required return, what is fair price?',
        difficulty: 'Intermediate',
        concepts: ['A→P', 'F→P'],
        annuities: [
            {
                time: '$Present',
                values: { presentVal: '', annualVal: 1000, futureVal: '', gradientVal: '', intVal: 0.08, nVal: 10 }
            },
            {
                time: '$Present',
                values: { presentVal: '', annualVal: '', futureVal: 10000, gradientVal: '', intVal: 0.08, nVal: 10 }
            }
        ]
    },
    {
        id: 'sinking-fund',
        title: '💰 Sinking Fund for Equipment',
        description: 'You need $100,000 in 5 years to replace equipment. How much must you deposit annually at 6% interest?',
        difficulty: 'Beginner',
        concepts: ['F→A'],
        annuities: [
            {
                time: '$Periodic',
                values: { presentVal: '', annualVal: '', futureVal: 100000, gradientVal: '', intVal: 0.06, nVal: 5 }
            }
        ]
    },
    {
        id: 'project-npv',
        title: '📊 Project NPV Analysis',
        description: 'A project costs $200,000 upfront, generates $50,000/year for 6 years, with a $30,000 salvage value. At 12% MARR, is it profitable?',
        difficulty: 'Advanced',
        concepts: ['A→P', 'F→P', 'NPV'],
        annuities: [
            {
                time: '$Present',
                values: { presentVal: '', annualVal: 50000, futureVal: '', gradientVal: '', intVal: 0.12, nVal: 6 }
            },
            {
                time: '$Present',
                values: { presentVal: '', annualVal: '', futureVal: 30000, gradientVal: '', intVal: 0.12, nVal: 6 }
            }
        ],
        initialCost: 200000
    },
    {
        id: 'mortgage-comparison',
        title: '🏠 Mortgage with Down Payment',
        description: 'Compare a $300,000 home purchase: $60,000 down payment now, then monthly payments at 6.5% for 30 years. What is the total cost?',
        difficulty: 'Intermediate',
        concepts: ['P→A', 'A→F'],
        annuities: [
            {
                time: '$Periodic',
                values: { presentVal: 240000, annualVal: '', futureVal: '', gradientVal: '', intVal: 0.065, nVal: 30 }
            }
        ]
    },
    {
        id: 'escalating-salary',
        title: '💼 Career Earnings with Raises',
        description: 'Starting salary $50,000/year with $3,000 annual raises for 20 years at 5% discount rate. What is present value of career earnings?',
        difficulty: 'Advanced',
        concepts: ['A→P', 'G→P'],
        annuities: [
            {
                time: '$Present',
                values: { presentVal: '', annualVal: 50000, futureVal: '', gradientVal: '', intVal: 0.05, nVal: 20 }
            },
            {
                time: '$Present',
                values: { presentVal: '', annualVal: '', futureVal: '', gradientVal: 3000, intVal: 0.05, nVal: 20 }
            }
        ]
    },
    {
        id: 'college-fund',
        title: '🎓 College Savings Plan',
        description: 'Save for college: $5,000 initial deposit plus $200/month for 18 years at 6% annual return. How much for tuition?',
        difficulty: 'Beginner',
        concepts: ['P→F', 'A→F'],
        annuities: [
            {
                time: '$Future',
                values: { presentVal: 5000, annualVal: '', futureVal: '', gradientVal: '', intVal: 0.06, nVal: 18 }
            },
            {
                time: '$Future',
                values: { presentVal: '', annualVal: 2400, futureVal: '', gradientVal: '', intVal: 0.06, nVal: 18 }
            }
        ]
    },
    {
        id: 'lease-vs-buy',
        title: '🔧 Lease vs Buy Analysis',
        description: 'Equipment costs $80,000 to buy or $15,000/year to lease for 7 years. At 9% interest, which is cheaper (present cost)?',
        difficulty: 'Intermediate',
        concepts: ['A→P'],
        annuities: [
            {
                time: '$Present',
                values: { presentVal: '', annualVal: 15000, futureVal: '', gradientVal: '', intVal: 0.09, nVal: 7 }
            }
        ],
        note: 'Compare result to $80,000 purchase price'
    }
];

function Annuities() {
    // Multiple annuities state - each annuity has its own time, values, and results
    const [annuities, setAnnuities] = useState([
        { id: 1, time: '$Future', values: [], graphData: [], answer: 0, initialValues: null }
    ]);
    const [combinedGraphData, setCombinedGraphData] = useState([]);
    const [combinedTotal, setCombinedTotal] = useState(0);
    const [selectedExample, setSelectedExample] = useState(null);
    const [showExamples, setShowExamples] = useState(false);    const [showFormulas, setShowFormulas] = useState(false);    const [collapsedCashFlows, setCollapsedCashFlows] = useState(new Set([1]));

    // Toggle a single cash flow's collapsed state
    const toggleCashFlow = useCallback((id) => {
        setCollapsedCashFlows(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    // Check if any fields have values
    const hasAnyValues = annuities.some(a => 
        a.values && a.values.length > 0 && a.values.some(v => v !== 0)
    );

    // Compute annuity for a single annuity entry
    const computeSingleAnnuity = useCallback((annuityCall, time) => {
        const [inputPresent, inputAnnual, inputFuture, inputGradient, inputInterest, inputPeriods] = annuityCall;
        const newGraphData = [];
        
        if ((!inputPresent && !inputAnnual && !inputFuture && !inputGradient) || !inputInterest || !inputPeriods) {
            return { graphData: [], answer: 0 };
        }
        
        const calculations = {
            "$Future": {
                "PTOF": () => {
                    if (inputPresent) {
                        for (let i = 0; i <= inputPeriods; i++) {
                            const value = inputPresent * Math.pow(1 + inputInterest, i);
                            newGraphData.push({ period: i, value: value });
                        }
                    }
                },
                "ATOF": () => {
                    if (inputAnnual) {
                        for (let i = 0; i <= inputPeriods; i++) {
                            const value = inputAnnual * ((Math.pow(1 + inputInterest, i) - 1) / inputInterest);
                            newGraphData.push({ period: i, value: value });
                        }
                    }
                },
                "GTOF": () => {
                    if (inputGradient) {
                        for (let i = 0; i <= inputPeriods; i++) {
                            const value = inputGradient * ((Math.pow(1 + inputInterest, i) - 1) / (inputInterest ** 2) - i / inputInterest);
                            newGraphData.push({ period: i, value: value });
                        }
                    }
                }
            },
            "$Present": {
                "FTOP": () => {
                    if (inputFuture) {
                        for (let i = 0; i <= inputPeriods; i++) {
                            const value = inputFuture * Math.pow(1 / (1 + inputInterest), i);
                            newGraphData.push({ period: i, value: value });
                        }
                    }
                },
                "ATOP": () => {
                    if (inputAnnual) {
                        for (let i = 0; i <= inputPeriods; i++) {
                            const value = inputAnnual * ((Math.pow(1 + inputInterest, i) - 1) / (inputInterest * Math.pow(1 + inputInterest, i)));
                            newGraphData.push({ period: i, value: value });
                        }
                    }
                },
                "GTOP": () => {
                    if (inputGradient) {
                        for (let i = 0; i <= inputPeriods; i++) {
                            const value = inputGradient * (1 / inputInterest) * ((Math.pow(1 + inputInterest, i) - 1) / (inputInterest * Math.pow(1 + inputInterest, i)) - i / Math.pow(1 + inputInterest, i));
                            newGraphData.push({ period: i, value: value });
                        }
                    }
                }
            },
            "$Periodic": {
                "FTOA": () => {
                    if (inputFuture) {
                        for (let i = 0; i <= inputPeriods; i++) {
                            const value = inputFuture * (inputInterest / (Math.pow(1 + inputInterest, i) - 1));
                            newGraphData.push({ period: i, value: value });
                        }
                    }
                },
                "PTOA": () => {
                    if (inputPresent) {
                        for (let i = 0; i <= inputPeriods; i++) {
                            const value = inputPresent * inputInterest * Math.pow(1 + inputInterest, i) / (Math.pow(1 + inputInterest, i) - 1);
                            newGraphData.push({ period: i, value: value });
                        }
                    }
                },
                "GTOA": () => {
                    if (inputGradient) {
                        for (let i = 0; i <= inputPeriods; i++) {
                            const value = inputGradient * ((1 / inputInterest) - (i / (Math.pow(1 + inputInterest, i) - 1)));
                            newGraphData.push({ period: i, value: value });
                        }
                    }
                }
            }
        };

        Object.values(calculations[time] || {}).forEach(fn => fn());
        
        // Combine values at each period (sum values for the same period)
        const combinedByPeriod = {};
        newGraphData.forEach(({ period, value }) => {
            if (combinedByPeriod[period] === undefined) {
                combinedByPeriod[period] = 0;
            }
            combinedByPeriod[period] += value;
        });
        
        // Convert back to array format
        const combinedGraphData = Object.entries(combinedByPeriod)
            .map(([period, value]) => ({ period: parseInt(period), value }))
            .sort((a, b) => a.period - b.period);
        
        // Get the final period value
        const finalValue = combinedGraphData.length > 0 
            ? combinedGraphData[combinedGraphData.length - 1].value 
            : 0;

        return {
            graphData: combinedGraphData,
            answer: !isNaN(finalValue) ? finalValue : 0
        };
    }, []);

    // Update a specific annuity's values
    const updateAnnuityValues = useCallback((id, newValues) => {
        setAnnuities(prev => prev.map(a => {
            if (a.id === id) {
                const result = computeSingleAnnuity(newValues, a.time);
                return { ...a, values: newValues, graphData: result.graphData, answer: result.answer };
            }
            return a;
        }));
    }, [computeSingleAnnuity]);

    // Update a specific annuity's time (find type)
    const updateAnnuityTime = useCallback((id, newTime) => {
        setAnnuities(prev => prev.map(a => {
            if (a.id === id) {
                const result = computeSingleAnnuity(a.values, newTime);
                return { ...a, time: newTime, graphData: result.graphData, answer: result.answer };
            }
            return a;
        }));
    }, [computeSingleAnnuity]);

    // Add a new annuity form
    const addAnnuity = useCallback(() => {
        const newId = Math.max(...annuities.map(a => a.id), 0) + 1;
        setAnnuities(prev => [...prev, { id: newId, time: '$Future', values: [], graphData: [], answer: 0, initialValues: null }]);
        setCollapsedCashFlows(prev => new Set([...prev, newId]));
    }, [annuities]);

    // Remove an annuity form
    const removeAnnuity = useCallback((id) => {
        if (annuities.length > 1) {
            setAnnuities(prev => prev.filter(a => a.id !== id));
        }
    }, [annuities.length]);

    // Load an example problem
    const loadExample = useCallback((example) => {
        setSelectedExample(example);
        setShowExamples(false);
        
        const newAnnuities = example.annuities.map((ann, index) => {
            // Pre-compute values so the graph updates immediately (even while collapsed)
            const vals = ann.values;
            const valuesArray = [
                parseFloat(vals.presentVal) || 0,
                parseFloat(vals.annualVal) || 0,
                parseFloat(vals.futureVal) || 0,
                parseFloat(vals.gradientVal) || 0,
                parseFloat(vals.intVal) || 0,
                parseFloat(vals.nVal) || 0,
            ];
            const result = computeSingleAnnuity(valuesArray, ann.time);
            return {
                id: index + 1,
                time: ann.time,
                values: valuesArray,
                graphData: result.graphData,
                answer: result.answer,
                initialValues: ann.values
            };
        });
        
        // Collapse all cash flows by default when loading an example
        setCollapsedCashFlows(new Set(newAnnuities.map(a => a.id)));
        setAnnuities(newAnnuities);
    }, [computeSingleAnnuity]);

    // Clear and start fresh
    const clearCalculator = useCallback(() => {
        setSelectedExample(null);
        setCollapsedCashFlows(new Set());
        // Use timestamp to force a fresh component mount
        setAnnuities([{ id: Date.now(), time: '$Future', values: [], graphData: [], answer: 0, initialValues: null }]);
    }, []);

    // Combine all annuity graph data whenever annuities change
    useEffect(() => {
        // Find the maximum period across all annuities
        let maxPeriod = 0;
        annuities.forEach(a => {
            a.graphData.forEach(d => {
                if (d.period > maxPeriod) maxPeriod = d.period;
            });
        });

        // Build combined data by summing values at each period
        const combined = [];
        for (let p = 0; p <= maxPeriod; p++) {
            let sum = 0;
            annuities.forEach(a => {
                const dataPoint = a.graphData.find(d => d.period === p);
                if (dataPoint) sum += dataPoint.value;
            });
            combined.push({ period: p, value: sum });
        }

        setCombinedGraphData(combined);
        
        // Calculate combined total (value at final period)
        const total = annuities.reduce((sum, a) => sum + a.answer, 0);
        setCombinedTotal(total);
    }, [annuities]);

    const options = ['$Present', '$Periodic', '$Future'];

    const getDifficultyColor = (difficulty) => {
        switch (difficulty) {
            case 'Beginner': return '#4caf50';
            case 'Intermediate': return '#ff9800';
            case 'Advanced': return '#f44336';
            default: return '#666';
        }
    };

    return (
        <>
            <Header />
            <div className='annuities'>
                <div className='annuities-header'>
                    <h1 className='annuities-title'>Annuities</h1>
                    <p className='annuities-subtitle'>Time Value of Money & Cash Flow Analysis</p>
                </div>

                {/* Example Problems Section */}
                <div className='examples-section'>
                    <div className='examples-header'>
                        <h2 className='examples-title'>
                            📚 Example Problems
                            <button 
                                className='toggle-examples-btn'
                                onClick={() => setShowExamples(!showExamples)}
                            >
                                {showExamples ? '▼ Hide' : '▶ Show'}
                            </button>
                        </h2>
                        {hasAnyValues && (
                            <button className='clear-example-btn' onClick={clearCalculator}>
                                ✕ Clear & Start Fresh
                            </button>
                        )}
                    </div>
                    
                    {showExamples && (
                        <div className='examples-grid'>
                            {exampleProblems.map((example) => (
                                <div 
                                    key={example.id}
                                    className={`example-card ${selectedExample?.id === example.id ? 'selected' : ''}`}
                                    onClick={() => loadExample(example)}
                                >
                                    <div className='example-card-header'>
                                        <h3 className='example-title'>{example.title}</h3>
                                        <span 
                                            className='example-difficulty'
                                            style={{ backgroundColor: getDifficultyColor(example.difficulty) }}
                                        >
                                            {example.difficulty}
                                        </span>
                                    </div>
                                    <p className='example-description'>{example.description}</p>
                                    <div className='example-concepts'>
                                        {example.concepts.map((concept, i) => (
                                            <span key={i} className='concept-tag'>{concept}</span>
                                        ))}
                                    </div>
                                    {example.note && (
                                        <p className='example-note'>💡 {example.note}</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Selected Example Info */}
                {selectedExample && (
                    <div className='selected-example-info'>
                        <h3>{selectedExample.title}</h3>
                        <p>{selectedExample.description}</p>
                        {selectedExample.initialCost && (
                            <p className='initial-cost-note'>
                                ⚠️ Initial Cost: <strong>${selectedExample.initialCost.toLocaleString()}</strong> 
                                (subtract from total present value for NPV)
                            </p>
                        )}
                    </div>
                )}

                {/* Calculator Section */}
                <div className='calculator-section'>
                    {/* Multiple Annuity Forms */}
                    {annuities.map((annuity, index) => {
                        const isCollapsed = collapsedCashFlows.has(annuity.id);
                        return (
                        <div key={annuity.id} className={`annuity-form-container ${isCollapsed ? 'annuity-form-collapsed' : ''}`}>
                            <div className='annuity-form-header' onClick={() => toggleCashFlow(annuity.id)} style={{ cursor: 'pointer' }}>
                                <div className='annuity-form-header-left'>
                                    <span className='annuity-form-toggle'>{isCollapsed ? '▶' : '▼'}</span>
                                    <span className='annuity-form-number'>Cash Flow #{index + 1}</span>
                                    {isCollapsed && (
                                        <span className='annuity-form-summary'>
                                            <span className='annuity-form-summary-type'>{annuity.time.substring(1)}</span>
                                            {annuity.answer !== 0 && !isNaN(annuity.answer) && (
                                                <span className='annuity-form-summary-value'>
                                                    ${annuity.answer.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </span>
                                            )}
                                        </span>
                                    )}
                                </div>
                                {annuities.length > 1 && (
                                    <button 
                                        className='remove-annuity-btn'
                                        onClick={(e) => { e.stopPropagation(); removeAnnuity(annuity.id); }}
                                        title="Remove this cash flow"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                            
                            {!isCollapsed && (
                            <div className='annuity-form-content'>
                                <div className='annuities-find-inline'>
                                    <label className='annuities-find-label'>Find:</label>
                                    <Dropdown
                                        id={`annuities-find-dropdown-${annuity.id}`}
                                        options={options}
                                        onChange={(e) => updateAnnuityTime(annuity.id, e.value)}
                                        value={annuity.time}
                                        placeholder="Select an option"
                                        className='annuities-find-dropdown'
                                    />
                                </div>

                                <div className='annuities-newannuity'>
                                    <NewAnnuity 
                                        tenseAnnuity={annuity.time} 
                                        onNewAnnuity={(values) => updateAnnuityValues(annuity.id, values)}
                                        initialValues={annuity.initialValues}
                                    />
                                </div>

                                {(annuity.answer !== 0 && !isNaN(annuity.answer)) && (
                                    <div className='annuity-result-inline'>
                                        <span className='annuity-result-text'>
                                            {annuity.time.substring(1)} Value: <strong>${annuity.answer.toLocaleString('en-US', {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2
                                            })}</strong>
                                        </span>
                                    </div>
                                )}
                            </div>
                            )}
                        </div>
                    );
                    })}

                    {/* Add Annuity Button */}
                    <button className='add-annuity-btn' onClick={addAnnuity}>
                        ➕ Add Another Cash Flow
                    </button>

                    {/* Combined Output Section */}
                    {combinedGraphData.length > 0 && (
                        <>
                            <div className='combined-total-section'>
                                <h3>📊 Combined Results</h3>
                                <div className='combined-total-value'>
                                    Total Value: ${combinedTotal.toLocaleString('en-US', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2
                                    })}
                                </div>
                                {selectedExample?.initialCost && (
                                    <div className='npv-calculation'>
                                        <span>Net Present Value (NPV): </span>
                                        <strong className={combinedTotal - selectedExample.initialCost >= 0 ? 'positive' : 'negative'}>
                                            ${(combinedTotal - selectedExample.initialCost).toLocaleString('en-US', {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2
                                            })}
                                        </strong>
                                        <span className='npv-verdict'>
                                            {combinedTotal - selectedExample.initialCost >= 0 ? ' ✅ Profitable' : ' ❌ Not Profitable'}
                                        </span>
                                    </div>
                                )}
                                {annuities.length > 1 && (
                                    <div className='individual-values'>
                                        {annuities.map((a, idx) => (
                                            <span key={a.id} className='individual-value'>
                                                #{idx + 1}: ${a.answer.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className='annuities-output'>
                                <GraphAnnuities
                                    chartData={combinedGraphData}
                                    key={`graph-${combinedGraphData.length}-combined`}
                                    tenseAnnuity={annuities.length === 1 ? annuities[0].time : '$Combined'}
                                />
                            </div>
                        </>
                    )}
                </div>

                {/* Formula Reference Section */}
                <div className='annuities-description'>
                    <h3 className='formula-ref-header' onClick={() => setShowFormulas(!showFormulas)} style={{ cursor: 'pointer' }}>
                        <span>{showFormulas ? '▼' : '▶'}</span> 📖 Formula Reference
                    </h3>
                    {showFormulas && (<>
                    <p>
                        <strong>Quick Start:</strong> Select what you want to find (Present, Periodic, or Future value), 
                        enter your known values, and the calculator will compute the result.
                    </p>
                    <p>
                        This calculator supports the following conversions: <span className='hover-hint'>(hover for details)</span>
                    </p>
                    <ul className='conversion-list'>
                        <li className='conversion-item'>
                            <span className='conversion-name'>(P→A) - Capital Recovery</span>
                            <span className='conversion-tooltip'>Calculates the equal periodic payment needed to repay a present amount (loan). Used for determining loan payments, equipment financing, or any situation where you need to recover an initial investment through equal periodic amounts.</span>
                        </li>
                        <li className='conversion-item'>
                            <span className='conversion-name'>(P→F) - Single Payment Compound Amount</span>
                            <span className='conversion-tooltip'>Finds the future value of a single present amount after compound interest. Answers "If I invest $X today, how much will I have in N periods?" Used for savings growth projections and investment planning.</span>
                        </li>
                        <li className='conversion-item'>
                            <span className='conversion-name'>(F→P) - Single Payment Present Worth</span>
                            <span className='conversion-tooltip'>Calculates today's value of a future sum. Answers "What is $X received in N periods worth today?" Essential for comparing investment opportunities and determining if future cash flows justify current expenditures.</span>
                        </li>
                        <li className='conversion-item'>
                            <span className='conversion-name'>(G→F) - Uniform Gradient Future Worth</span>
                            <span className='conversion-tooltip'>Finds the future value of payments that increase by a constant amount each period. Used when costs or revenues grow linearly, like maintenance costs that increase each year or salary increases.</span>
                        </li>
                        <li className='conversion-item'>
                            <span className='conversion-name'>(G→P) - Uniform Gradient Present Worth</span>
                            <span className='conversion-tooltip'>Calculates present value of a series of payments that increase by a constant amount each period. Useful for evaluating projects with escalating costs or benefits over time.</span>
                        </li>
                        <li className='conversion-item'>
                            <span className='conversion-name'>(G→A) - Uniform Gradient Uniform Series</span>
                            <span className='conversion-tooltip'>Converts a gradient series into an equivalent uniform series. Helps compare irregular increasing payments to a standard annuity for easier analysis and comparison.</span>
                        </li>
                        <li className='conversion-item'>
                            <span className='conversion-name'>(A→F) - Uniform Series Compound Amount</span>
                            <span className='conversion-tooltip'>Finds the future value of equal periodic deposits. Answers "If I save $X every period, how much will I have?" Perfect for retirement planning, savings goals, and investment accumulation.</span>
                        </li>
                        <li className='conversion-item'>
                            <span className='conversion-name'>(A→P) - Uniform Series Present Worth</span>
                            <span className='conversion-tooltip'>Calculates the lump sum today equivalent to receiving equal payments over time. Used to determine the present value of rental income, pension payments, or any recurring cash flow.</span>
                        </li>
                        <li className='conversion-item'>
                            <span className='conversion-name'>(F→A) - Uniform Series Sinking Fund</span>
                            <span className='conversion-tooltip'>Determines equal periodic deposits needed to accumulate a future amount. Answers "How much must I save each period to have $X?" Used for planning major purchases, equipment replacement funds, or debt payoff.</span>
                        </li>
                    </ul>
                    </>)}
                </div>
            </div>
            <Footer />
        </>
    );
}

export default Annuities;
