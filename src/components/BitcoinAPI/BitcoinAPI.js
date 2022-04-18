import React, { useEffect, useState } from "react";
import "./BitcoinAPI.css";

const url = "https://api.coindesk.com/v1/bpi/currentprice.json";        // Initialize the API URL


function BitcoinAPI(){

    const [price, setPrice] = useState(null);
    const [reloadButton, callReloadButton] = useState(0)

    // whenever the button is press and inital load this is called
    useEffect(() => {
        // returns float of bitcoin price
        async function getPrice(){                                              // Async function(waits for data to execute) that returns the price of Bitcoin
            const response = await fetch(url);                                  // fetch json
            const data = await response.json();                                 // assign json to variable
            setPrice("$ "+data.bpi.USD.rate_float.toFixed(2));                                        // assign the price string to variable
        }
        getPrice();
        // console.log(reloadButton);
    }, [reloadButton])

    // on first load, call the get price function
    useEffect(() => {
        callReloadButton(reloadButton+1);
    },[])


    return(<>
        <div className='bitcoinapi-space'>
            <div className='bitcoinapi-space-title'>
                USD to Bitcoin Canversion Rate
            </div>
            <div className='bitcoinapi-space-description'>
                click the number to refresh each minute
            </div>
            <button className='bitcoinapi-space-button' onClick={() => callReloadButton(reloadButton+1)}>
                <div className='bitcoinapi-space-button-price'>
                    <span>{price}</span>
                </div>
            </button>
        </div>
    </>)
}

export default BitcoinAPI;