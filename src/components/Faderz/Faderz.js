import React, { useEffect, useState } from "react";

function Faderz(props){
    let text;
    if(props.text){text=props.text}
    if(!props.text){text="no text input"}



    const [fadeProp, setFadeProp] = useState({
        fade: 'fade-in',
    });

    useEffect(() => {
        const timeout = setInterval(() => {
            if(props.yOff>props.tIn&&props.yOff<props.tOut){
                setFadeProp({
                    fade: 'fade-in',
                })
            } else{
                setFadeProp({
                    fade: 'fade-out',
                })
            }


            // if (fadeProp.fade === 'fade-in') {
            //     setFadeProp({
            //         fade: 'fade-out',
            //     })
            // } else {
            //     setFadeProp({
            //         fade: 'fade-in',
            //     })
            // }
        },props.yOff)
    });



    return(<>
        <div className={fadeProp.fade}>
            {text}
        </div>
    </>)
}
export default Faderz;