import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { getData, resetDataSlice } from '../../../features/data/dataSlice.js';
import { toast } from 'react-toastify';
import Dropdown from "react-dropdown";
import "react-dropdown/style.css";
import NewAnnuity from './NewAnnuity';
import GraphAnnuities from './GraphAnnuities';
import Footer from '../../../components/Footer/Footer';
import Header from '../../../components/Header/Header';
import "./Annuities.css";

function Annuities() {
    const [answer, setAnswer] = useState(0);
    const [time, setTime] = useState('$Present');
    const [annuityCall, setAnnuityCall] = useState([]);
    const [graphData, setGraphData] = useState([]);

    useEffect(() => {
        const computeAnnuity = () => {
            // We'll use this to store the final period data
            let finalPeriodData = null;
            const [inputPresent, inputAnnual, inputFuture, inputGradient, inputInterest, inputPeriods] = annuityCall;
            const newGraphData = [];
            
            if ((!inputPresent && !inputAnnual && !inputFuture) || !inputInterest || !inputPeriods) {
                return;
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
                            let value = 0;
                            for (let i = 0; i <= inputPeriods; i++) {
                                value = inputFuture * Math.pow(1 / (1 + inputInterest), i);
                                newGraphData.push({ period: i, value: value });
                            }
                        }
                    },
                    "ATOP": () => {
                        if (inputAnnual) {
                            let value = 0;
                            for (let i = 0; i <= inputPeriods; i++) {
                                value = inputAnnual * ((Math.pow(1 + inputInterest, i) - 1) / (inputInterest * Math.pow(1 + inputInterest, i)));
                                newGraphData.push({ period: i, value: value });
                            }
                        }
                    },
                    "GTOP": () => {
                        if (inputGradient) {
                            let value = 0;
                            for (let i = 0; i <= inputPeriods; i++) {
                                value = inputGradient * (1 / inputInterest) * ((Math.pow(1 + inputInterest, i) - 1) / (inputInterest * Math.pow(1 + inputInterest, i)) - i / Math.pow(1 + inputInterest, i));
                                newGraphData.push({ period: i, value: value });
                            }
                        }
                    }
                },
                "$Periodic": {
                    "FTOA": () => {
                        if (inputFuture) {
                            let value = 0;
                            for (let i = 0; i <= inputPeriods; i++) {
                                value = inputFuture * (inputInterest / (Math.pow(1 + inputInterest, i) - 1));
                                newGraphData.push({ period: i, value: value });
                            }
                        }
                    },
                    "PTOA": () => {
                        if (inputPresent) {
                            let value = 0;
                            for (let i = 0; i <= inputPeriods; i++) {
                                value = inputPresent * inputInterest * Math.pow(1 + inputInterest, i) / (Math.pow(1 + inputInterest, i) - 1);
                                newGraphData.push({ period: i, value: value });
                            }
                        }
                    },
                    "GTOA": () => {
                        if (inputGradient) {
                            let value = 0;
                            for (let i = 0; i <= inputPeriods; i++) {
                                value = inputGradient * ((1 / inputInterest) - (i / (Math.pow(1 + inputInterest, i) - 1)));
                                newGraphData.push({ period: i, value: value });
                            }
                        }
                    }
                }
            };

            Object.values(calculations[time] || {}).forEach(fn => fn());
            
            // Find the data point with the highest period (the last one)
            if (newGraphData.length > 0) {
                finalPeriodData = newGraphData.reduce((latest, current) => 
                    current.period > latest.period ? current : latest, 
                    newGraphData[0]
                );
            }
            
            console.log('Before setting state - newGraphData:', newGraphData);
            console.log('Before setting state - finalPeriodData:', finalPeriodData);

            if (finalPeriodData && !isNaN(finalPeriodData.value)) {
                setAnswer(finalPeriodData.value);
                setGraphData(newGraphData);
            }
        };

        computeAnnuity();
    }, [annuityCall, time]);

    useEffect(() => {
        console.log('Annuities component rendered');
    }, []);

    useEffect(() => {
        console.log('graphData:', graphData);
    }, [graphData]);

    const options = ['$Present', '$Periodic', '$Future'];

    return (
        <>
            <Header />
            <div className='annuities'>
                <div className='annuities-header'>
                    <h1 className='annuities-title'>Annuities</h1>
                    <p className='annuities-subtitle'>Financial Annuity Calculator</p>
                </div>
                <div className='annuities-inputs'>
                    <div className='annuities-find'>
                        <label className='annuities-find-label'>Find:</label>
                        <Dropdown
                            id="annuities-find-dropdown-id"
                            options={options}
                            onChange={(e) => setTime(e.value)}
                            value={time}
                            placeholder="Select an option"
                            className='annuities-find-dropdown'
                        />
                    </div>
                </div>

                <div className='annuities-newannuity'>
                    <NewAnnuity tenseAnnuity={time} onNewAnnuity={setAnnuityCall} />
                </div>

                <div className='annuities-output'>
                    {console.log('Rendering GraphAnnuities with graphData:', graphData)}
                    <GraphAnnuities
                        chartData={graphData}
                        key={`graph-${graphData.length}-${time}`}
                        tenseAnnuity={time}
                    />
                </div>

                { ( answer !== 0 && !isNaN(answer) ) && (
                    <div className='annuities-resulttime'>
                        <p className='annuities-resulttime-text'>
                            The {time.substring(1)} Value at period {annuityCall[5] || 0} is ${answer.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                            })}.
                        </p>
                    </div>
                )}

                <div className='annuities-description'>
                    <p>
                        Example: If you have $500 and save $10 at 10% interest for 10 periods: Select $Future then enter 500 (present), 10 (periodic), 0.10 (interest), and 10 (periods).
                    </p>
                    <p>
                        This calculator supports the following annuity conversions:
                    </p>
                    <ul>
                        <li>(PtoA) - (CR) Capital Recovery</li>
                        <li>(PtoF) - (SPCA) Single Payment Compound Amount</li>
                        <li>(FtoP) - (SPPW) Single payment present worth</li>
                        <li>(GtoF) - (UGFW) Uniform gradient future worth</li>
                        <li>(GtoP) - (UGPW) Uniform gradient present worth</li>
                        <li>(GtoA) - (UGUS) Uniform gradient uniform series</li>
                        <li>(AtoF) - (USCA) Uniform series compound Amount</li>
                        <li>(AtoP) - (USPW) Uniform series present worth</li>
                        <li>(FtoA) - (USSF) Uniform series sinking fund</li>
                    </ul>
                </div>
            </div>
            <Footer />
        </>
    );
}

export default Annuities;