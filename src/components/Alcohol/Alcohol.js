import React, { useState } from "react";
import "./Alcohol.css";
import Footer from './../Footer/Footer';

var drinksImg = "https://www.niaaa.nih.gov/sites/default/files/What_Is_a_Standard_Drink_grayscale_508_Release_Web.jpg";

function Alcohol(){
    const [volumeInput, setVolumeInput] = useState("");
    const [percentInput, setPercentInput] = useState("");



    return(<>
        <div className='alcohol'>
            <div className="alcohol-title">
                Alcohol Volume Calculator
            </div>
            <div className="alcohol-description">
                This page is intended for educational and harm-prevention purposes only. This calculator estimates the number of standard alcoholic drinks in any beverage. 
            </div>

            <div className="alcohol-col">
                <div className="alcohol-niaaa">
                    <img id="alcohol-niaaa-img" src={drinksImg} alt="standard drinks from NIAAA" />
                    <br/>
                    To learn more, visit the
                    <a className="projects-source-inside" href="https://www.niaaa.nih.gov/alcohols-effects-health/overview-alcohol-consumption/what-standard-drink">
                        <button id="projects-source-button">NIAAA (National institute on Alcohol Abuse and Alcoholism)</button>
                    </a>
                </div>
            </div>

            <div className="alcohol-col">
                <div className="alcohol-calculator-title">
                    calculator
                </div>
                <div className="alcohol-calculator-input-title">
                    Beverage Volume
                    <br/>
                    <input placeholder="Enter Volume" onChange={e => setVolumeInput(e.target.value)} type="text"/>
                </div>
                <div className="alcohol-calculator-input-title">
                    Alcohol Content Percentage
                    <br/>
                    <input placeholder="Enter Percentage" onChange={e => setPercentInput(e.target.value)} type="text"/>
                </div>


            </div>


        </div>
        <Footer/>
    </>)
}

export default Alcohol;