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

    useEffect(() => setAnswer(0), [time]);

    useEffect(() => {
        const computeAnnuity = () => {
            let crntAnswer = 0;
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
                                crntAnswer = inputPresent * Math.pow(1 + inputInterest, i);
                                newGraphData.push({ period: i, value: crntAnswer });
                            }
                        }
                    },
                    "ATOF": () => {
                        if (inputAnnual) {
                            for (let i = 0; i <= inputPeriods; i++) {
                                crntAnswer = inputAnnual * ((Math.pow(1 + inputInterest, i) - 1) / inputInterest);
                                newGraphData.push({ period: i, value: crntAnswer });
                            }
                        }
                    },
                    "GTOF": () => {
                        if (inputGradient) {
                            for (let i = 0; i <= inputPeriods; i++) {
                                crntAnswer = inputGradient * ((Math.pow(1 + inputInterest, i) - 1) / (inputInterest ** 2) - i / inputInterest);
                                newGraphData.push({ period: i, value: crntAnswer });
                            }
                        }
                    }
                },
                "$Present": {
                    "FTOP": () => {
                        if (inputFuture) {
                            for (let i = 0; i <= inputPeriods; i++) {
                                crntAnswer = inputFuture * Math.pow(1 / (1 + inputInterest), i);
                                newGraphData.push({ period: i, value: crntAnswer });
                            }
                        }
                    },
                    "ATOP": () => {
                        if (inputAnnual) {
                            for (let i = 0; i <= inputPeriods; i++) {
                                crntAnswer = inputAnnual * ((Math.pow(1 + inputInterest, i) - 1) / (inputInterest * Math.pow(1 + inputInterest, i)));
                                newGraphData.push({ period: i, value: crntAnswer });
                            }
                        }
                    },
                    "GTOP": () => {
                        if (inputGradient) {
                            for (let i = 0; i <= inputPeriods; i++) {
                                crntAnswer = inputGradient * (1 / inputInterest) * ((Math.pow(1 + inputInterest, i) - 1) / (inputInterest * Math.pow(1 + inputInterest, i)) - i / Math.pow(1 + inputInterest, i));
                                newGraphData.push({ period: i, value: crntAnswer });
                            }
                        }
                    }
                },
                "$Periodic": {
                    "FTOA": () => {
                        if (inputFuture) {
                            for (let i = 0; i <= inputPeriods; i++) {
                                crntAnswer = inputFuture * (inputInterest / (Math.pow(1 + inputInterest, i) - 1));
                                newGraphData.push({ period: i, value: crntAnswer });
                            }
                        }
                    },
                    "PTOA": () => {
                        if (inputPresent) {
                            for (let i = 0; i <= inputPeriods; i++) {
                                crntAnswer = inputPresent * inputInterest * Math.pow(1 + inputInterest, i) / (Math.pow(1 + inputInterest, i) - 1);
                                newGraphData.push({ period: i, value: crntAnswer });
                            }
                        }
                    },
                    "GTOA": () => {
                        if (inputGradient) {
                            for (let i = 0; i <= inputPeriods; i++) {
                                crntAnswer = inputGradient * ((1 / inputInterest) - (i / (Math.pow(1 + inputInterest, i) - 1)));
                                newGraphData.push({ period: i, value: crntAnswer });
                            }
                        }
                    }
                }
            };

            Object.values(calculations[time] || {}).forEach(fn => fn());

            console.log('Before setting state - newGraphData:', newGraphData);
            console.log('Before setting state - crntAnswer:', crntAnswer);

            setAnswer(crntAnswer);
            setGraphData(newGraphData);
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
                    {/* <GraphAnnuities chartData={graphData} /> */}
                </div>

                { ( answer !== 0 && !isNaN(answer) ) && (
                    <div className='annuities-resulttime'>
                        <p className='annuities-resulttime-text'>
                            The {time.substring(1)} Value would be ${answer.toFixed(2)}.
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
            <a href="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/Annuities" rel="noopener noreferrer" target="_blank">
                <div className='newAnnuity-space'>
                    <button id="newAnnuity" className='view-source-btn'>View Source Code</button>
                </div>
            </a>
            <Footer />
        </>
    );
}

export default Annuities;