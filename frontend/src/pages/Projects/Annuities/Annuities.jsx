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
    const rootStyle = window.getComputedStyle(document.body);
    const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);

    const dispatch = useDispatch();
    const [powerMode, setPowerMode] = useState(false);
    const effectRan = useRef(false);

    const { user, dataIsSuccess } = useSelector((state) => state.data);

    useEffect(() => {
        if (effectRan.current === false) {
            effectRan.current = true;

            const getMyData = async () => {
                try {
                    if (!user || !user._id || user._id === '64efe9e2c42368e193ee6977') {
                        setPowerMode(false);
                        return;
                    }
                    setPowerMode(true);
                    toast.success('Power user active.', { autoClose: toastDuration });
                    await dispatch(getData({ data: "Net:" }));
                } catch (error) {
                    toast.error(error.message, { autoClose: toastDuration });
                }
            };

            if (!dataIsSuccess) {
                getMyData();
            }
        }

        return () => {
            dispatch(resetDataSlice());
        };
    }, [dispatch, toastDuration, user, dataIsSuccess]);

    const [answer, setAnswer] = useState(0);
    const [showNewAnnuity, setShowNewAnnuity] = useState(true);
    const [time, setTime] = useState('$Present');
    const [annuityCall, setAnnuityCall] = useState([]);

    useEffect(() => setAnswer(0), [time]);

    useEffect(() => {
        const computeAnnuity = () => {
            let crntAnswer = 0;
            const [inputPresent, inputAnnual, inputFuture, inputGradient, inputInterest, inputPeriods] = annuityCall;

            const calculations = {
                "$Future": {
                    "PTOF": () => inputPresent && (crntAnswer += inputPresent * Math.pow(1 + inputInterest, inputPeriods)),
                    "ATOF": () => inputAnnual && (crntAnswer += inputAnnual * ((Math.pow(1 + inputInterest, inputPeriods) - 1) / inputInterest)),
                    "GTOF": () => inputGradient && (crntAnswer += inputGradient * ((Math.pow(1 + inputInterest, inputPeriods) - 1) / (inputInterest ** 2) - inputPeriods / inputInterest))
                },
                "$Present": {
                    "FTOP": () => inputFuture && (crntAnswer += inputFuture * Math.pow(1 / (1 + inputInterest), inputPeriods)),
                    "ATOP": () => inputAnnual && (crntAnswer += inputAnnual * ((Math.pow(1 + inputInterest, inputPeriods) - 1) / (inputInterest * Math.pow(1 + inputInterest, inputPeriods)))),
                    "GTOP": () => inputGradient && (crntAnswer += inputGradient * (1 / inputInterest) * ((Math.pow(1 + inputInterest, inputPeriods) - 1) / (inputInterest * Math.pow(1 + inputInterest, inputPeriods)) - inputPeriods / Math.pow(1 + inputInterest, inputPeriods)))
                },
                "$Periodic": {
                    "FTOA": () => inputFuture && (crntAnswer += inputFuture * (inputInterest / (Math.pow(1 + inputInterest, inputPeriods) - 1))),
                    "PTOA": () => inputPresent && (crntAnswer += inputPresent * inputInterest * Math.pow(1 + inputInterest, inputPeriods) / (Math.pow(1 + inputInterest, inputPeriods) - 1)),
                    "GTOA": () => inputGradient && (crntAnswer += inputGradient * ((1 / inputInterest) - (inputPeriods / (Math.pow(1 + inputInterest, inputPeriods) - 1))))
                }
            };

            Object.values(calculations[time] || {}).forEach(fn => fn());

            setAnswer(crntAnswer);
        };

        computeAnnuity();
    }, [annuityCall, time]);

    const options = ['$Present', '$Periodic', '$Future'];

    return (
        <>
            <Header />
            <div className='annuities'>
                <div className='annuities-title'>Annuities</div>
                <div className='annuities-subtitle'>Financial Annuity Calculator</div>
                <div className='annuities-inputs'>
                    <div className='annuities-find-text'>Find:</div>
                    <div className='annuities-find-dropdown'>
                        <Dropdown
                            id="annuities-find-dropdown-id"
                            options={options}
                            onChange={(e) => setTime(e.value)}
                            value={time}
                            placeholder="Select an option"
                        />
                    </div>
                    <button
                        onClick={() => setShowNewAnnuity(!showNewAnnuity)}
                        id='newAnnuity'
                        type='button'>
                        Toggle New Visibility
                    </button>
                </div>

                <div className='annuities-newannuity'>
                    {showNewAnnuity && <NewAnnuity tenseAnnuity={time} onNewAnnuity={setAnnuityCall} />}
                </div>

                {answer !== 0 && powerMode &&
                    <div className='annuities-output'>
                        <span className='annuities-output-span'>
                            <GraphAnnuities chartValue={answer} chartData={annuityCall} />
                        </span>
                    </div>
                }

                <div className='annuities-resulttime'>
                    {answer !== 0 &&
                        <div className='annuities-resulttime-text'>
                            The {time.substring(1)} Value would be ${answer.toFixed(2)}.
                        </div>
                    }
                </div>

                <div className='annuities-description'>
                    Example: If you have $500 and save $10 at 10% interest for 10 periods: Select $Future then enter 500 (present), 10 (periodic), 0.10 (interest), and 10 (periods).
                    <br /><br />
                    This calculator supports the following annuity conversions:
                    <br /><br />
                    (PtoA) - (CR) Capital Recovery
                    <br />
                    (PtoF) - (SPCA) Single Payment Compound Amount
                    <br />
                    (FtoP) - (SPPW) Single payment present worth
                    <br />
                    (GtoF) - (UGFW) Uniform gradient future worth
                    <br />
                    (GtoP) - (UGPW) Uniform gradient present worth
                    <br />
                    (GtoA) - (UGUS) Uniform gradient uniform series
                    <br />
                    (AtoF) - (USCA) Uniform series compound Amount
                    <br />
                    (AtoP) - (USPW) Uniform series present worth
                    <br />
                    (FtoA) - (USSF) Uniform series sinking fund
                </div>
            </div>
            <a href="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/Annuities" rel="noopener noreferrer" target="_blank">
                <div className='newAnnuity-space'>
                    <button id="newAnnuity">View Source Code</button>
                </div>
            </a>
            <Footer />
        </>
    );
}

export default Annuities;