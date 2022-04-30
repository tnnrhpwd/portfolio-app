import React, { useState } from "react";
import Footer from '../Footer/Footer';
import Dropdown from "react-dropdown";
import EthanolVisual from "./EthanolVisual.js";
import "./Ethanol.css";


const ETHANOL_DENSITY = 0.78945 ; // grams / cubic centimeter
const FLOZ_TO_MILLILITERS = 29.57353;
const drinksImg = "https://www.niaaa.nih.gov/sites/default/files/What_Is_a_Standard_Drink_grayscale_508_Release_Web.jpg";
const NIAAA_LINK = "https://www.niaaa.nih.gov/alcohols-effects-health/overview-alcohol-consumption/what-standard-drink";
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
                Ethanol Content Calculator
            </div>
            <div className="ethanol-description">
                This calculator estimates standard alcoholic drinks.  This page is intended for educational and harm-prevention purposes only.
            </div>

            <div className="ethanol-col1">
                <div className="ethanol-niaaa">
                    <img id="ethanol-niaaa-img" src={drinksImg} alt="standard drinks from NIAAA" />
                    <br/>
                    To learn more, visit the
                    <a className="ethanol-niaaa-inside" href={NIAAA_LINK} rel="noreferrer" target="_blank">
                        <button id="ethanol-niaaa-button">NIAAA (National Institute on Alcohol Abuse and Alcoholism)</button>
                    </a>
                </div>
            </div>

            <div className="ethanol-col2">
                <div className="ethanol-calculator">
                    <div className="ethanol-calculator-title">
                        Standard Drinks
                    </div>
                    <div className="ethanol-calculator-volume">
                        <div className="ethanol-calculator-input-title">
                            Beverage Volume:
                        </div>
                        <input id="ethanol-calculator-input" placeholder="Volume" onChange={e => setVolumeInput(e.target.value)} type="text"/>
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
                            Standard Ethanol Grams / Drink:
                        </div>
                        <input id="ethanol-calculator-input" placeholder="Grams" onChange={e => setStandardGrams(e.target.value)} type="text"/>
                        <div className="ethanol-calculator-standard-description">
                            The standard is 14 grams in the United States.
                        </div>
                        <a className="ethanol-calculator-standard-inside" href={STANDARD_LINK} rel="noreferrer" target="_blank">
                            <button className="ethanol-calculator-standard-button">Click here to learn more!</button>
                        </a>
                        
                    </div>

                    <div className="ethanol-calculator-percent">
                        <div className="ethanol-calculator-input-title">
                            Ethanol (Alcohol) Content Percentage:
                        </div>
                        <input id="ethanol-calculator-input" placeholder="Percent" onChange={e => setPercentInput(e.target.value)} type="text"/>
                    </div>

                    <button id="ethanol-calculator-submit" onClick={handleSubmit}>Submit</button>

                </div>
                
            </div>
            {(output>0) && 
                <div className="ethanol-col3">
                    <div className="ethanol-output">
                        {output} Standard Drinks
                    </div>
                    <div className="ethanol-ethanolvisual">
                        <EthanolVisual out={output}/>
                    </div>
                </div>
            }

        </div>
        <Footer/>
    </>)
}

export default Ethanol;