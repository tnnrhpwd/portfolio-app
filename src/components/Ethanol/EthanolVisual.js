import React, { useEffect, useState } from 'react'
import {CircularProgressbar} from "react-circular-progressbar";
import 'react-circular-progressbar/dist/styles.css';

function EthanolVisual(props) {

    var circleArray = [];

    const [stateArray, setStateArray] = useState([]);

    // props.out

   

    useEffect(() => {
        
        for(let i = 0; i < Math.floor(props.out); i++){
            circleArray.push(<div className='ethanolvisual-circles' key={i} ><CircularProgressbar key={i} value={100}/></div>)
            if( i%10===0 && i!==0 ){circleArray.push(<br/>)}
        }


        let decimal;
        if(!Number.isInteger(props.out)){
            decimal = props.out - Math.floor(props.out);
            circleArray.push(<div className='ethanolvisual-circles' key={11111} ><CircularProgressbar key={-1} value={decimal}/></div>)
        }



        setStateArray(circleArray);
        console.log("test")
    },[props.out]);

    return (
        <div className='ethanolvisual'>
            {stateArray}
        </div>
    )
    
    
}

export default EthanolVisual;