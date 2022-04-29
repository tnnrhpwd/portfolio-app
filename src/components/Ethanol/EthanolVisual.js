import React, { useEffect, useState } from 'react'
import {CircularProgressbar} from "react-circular-progressbar";
import 'react-circular-progressbar/dist/styles.css';

function EthanolVisual(props) {
    var circleArray = [];    // temporary array
    const [stateArray, setStateArray] = useState([]);    // output array

    useEffect(() => {   // RUN on EACH INPUT
        // add input integer number of circles.
        for(let i = 0; i < Math.floor(props.out); i++){
            circleArray.push(<div className='ethanolvisual-circles' key={i} ><CircularProgressbar key={i} value={100}/></div>)
            if( (i+1)%10===0 && i!==0 ){circleArray.push(<br/>)}
        }

        let decimal;
         // if input exists && has decimal ending, add partial circle
        if(!Number.isInteger(props.out) && props.out > 0){ 
            decimal = (props.out - Math.floor(props.out)) * 100;
            circleArray.push(<div className='ethanolvisual-circles' key={11111} ><CircularProgressbar key={-1} value={decimal}/></div>)
        }

        // output array
        setStateArray(circleArray);
    },[props.out]);

    return (
        <div className='ethanolvisual'>
            {stateArray}
        </div>
    )
    
    
}

export default EthanolVisual;