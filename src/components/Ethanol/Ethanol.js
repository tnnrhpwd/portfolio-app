import React, { useState } from "react";
import "./Ethanol.css";
import Footer from '../Footer/Footer';
import Dropdown from "react-dropdown";
import EthanolVisual from "./EthanolVisual.js";


const ETHANOL_DENSITY = 0.78945 ; // grams / cubic centimeter
const FLOZ_TO_MILLILITERS = 29.57353;
const drinksImg = "https://www.niaaa.nih.gov/sites/default/files/What_Is_a_Standard_Drink_grayscale_508_Release_Web.jpg";
const STANDARD_LINK = "https://en.wikipedia.org/wiki/Standard_drink";

function Ethanol(){
    const [volumeInput, setVolumeInput] = useState("");
    const [volumeUnits, setVolumeUnits] = useState("Milliliters");
    const [standardGrams, setStandardGrams] = useState(14);
    const [percentInput, setPercentInput] = useState("");
    const [output, setOutput] = useState("");

    function handleSubmit(){
        // GUARD CLAUSE --

        let liters =0;
        if(volumeUnits==="Milliliters"){
            liters = (parseFloat(volumeInput)/1000);
        }
        if(volumeUnits==="Fluid Ounces"){
            liters = (parseFloat(volumeInput)*FLOZ_TO_MILLILITERS/1000);
        }



        let percent = parseFloat(percentInput);

        let standardConversion = parseFloat(standardGrams)/10;

        let answer = ((liters*percent*ETHANOL_DENSITY)/standardConversion).toFixed(2)

        setOutput(answer);
    }

    const volumeOptions = ["Milliliters","Fluid Ounces"];



    return(<>
        <div className='ethanol'>
            <div className="ethanol-title">
                Ethanol Volume Calculator
            </div>
            <div className="ethanol-description">
                This page is intended for educational and harm-prevention purposes only. This calculator estimates the number of standard alcoholic drinks in any beverage. 
            </div>

            <div className="ethanol-col1">
                <div className="ethanol-niaaa">
                    <img id="ethanol-niaaa-img" src={drinksImg} alt="standard drinks from NIAAA" />
                    <br/>
                    To learn more, visit the
                    <a className="projects-source-inside" href="https://www.niaaa.nih.gov/alcohols-effects-health/overview-alcohol-consumption/what-standard-drink">
                        <button id="projects-source-button">NIAAA (National institute on Alcohol Abuse and Alcoholism)</button>
                    </a>
                </div>
            </div>

            <div className="ethanol-col2">
                <div className="ethanol-calculator-title">
                    Standard Drinks
                </div>
                <div className="ethanol-calculator-volume">
                    <div className="ethanol-calculator-input-title">
                        Beverage Volume
                    </div>
                    <input id="ethanol-calculator-input" placeholder="Enter Volume" onChange={e => setVolumeInput(e.target.value)} type="text"/>
                    <div className='ethanol-calculator-dropdown'>
                        <Dropdown 
                            options={volumeOptions}
                            onChange={(e) => setVolumeUnits(e.value)} 
                            value={volumeUnits} 
                            placeholder="Select an option" 
                        />
                    </div>
                </div>
                
                <div className="ethanol-calculator-standard">
                    <div className="ethanol-calculator-input-title">
                        Standard Ethanol Grams / Drink
                    </div>
                    <input id="ethanol-calculator-input" placeholder="Enter Grams" onChange={e => setStandardGrams(e.target.value)} type="text"/>
                </div>

                <div className="ethanol-calculator-percent">
                    <div className="ethanol-calculator-input-title">
                        Ethanol Content Percentage
                    </div>
                    <input id="ethanol-calculator-input" placeholder="Enter Percentage" onChange={e => setPercentInput(e.target.value)} type="text"/>
                </div>

                <button id="ethanol-calculator-submit" onClick={handleSubmit}>Submit</button>

            </div>

            <div className="ethanol-col3">
                <div className="ethanol-output">
                    {output}
                </div>
            </div>
            <div className="ethanol-ethanolvisual">
                <EthanolVisual out={output}/>
            </div>

        </div>
        <Footer/>
    </>)
}

export default Ethanol;