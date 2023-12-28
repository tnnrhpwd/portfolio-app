import React from "react";
import { Zoom } from "react-slideshow-image";
import Footer from '../../../components/Footer/Footer';
import NavBar from '../../../components/NavBar/NavBar';

import 'react-slideshow-image/dist/styles.css'
import "./Drafting.css";

const reel = [
    'https://sthopwood.weebly.com/uploads/1/3/3/6/133614175/draftcapture_orig.png',
    'https://sthopwood.weebly.com/uploads/1/3/3/6/133614175/campture_orig.png',
    'https://sthopwood.weebly.com/uploads/1/3/3/6/133614175/capsssture_orig.png',
    'https://sthopwood.weebly.com/uploads/1/3/3/6/133614175/caspture_orig.png',
    'https://sthopwood.weebly.com/uploads/1/3/3/6/133614175/capsture_orig.png',
    'https://sthopwood.weebly.com/uploads/1/3/3/6/133614175/captdddddure_orig.png',
    'https://sthopwood.weebly.com/uploads/1/3/3/6/133614175/captssure_orig.png',
    'https://sthopwood.weebly.com/uploads/1/3/3/6/133614175/cssssapture_orig.png',
    'https://sthopwood.weebly.com/uploads/1/3/3/6/133614175/hopwood-assignment02-page-001-orig_orig.jpg',
    'https://sthopwood.weebly.com/uploads/1/3/3/6/133614175/capssture_orig.png',
];

const zoomOutProperties = {
    duration: 2500,
    transitionDuration: 500,
    infinite: true,
    indicators: true,
    scale: 0.4,
    arrows: true
};

function Drafting() {

    return (<>
        <NavBar/>
        <div className="drafting">
            <div className="drafting-space">
                <Zoom {...zoomOutProperties}>
                    {reel.map((each, index) =>(
                        <img key={index} style={{width: "100%"}} alt="slideshow for CAD drafting pace" src={each} />
                    ))}
                </Zoom>
            </div>
            <div className="slide-button">
                <a href="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/Drafting" rel="noopener noreferrer" target="_blank">
                    <button id="newAnnuity">View Source Code</button>
                </a>
            </div>
            <Footer transparent="1" />
        </div>
    </>);
};

export default Drafting;