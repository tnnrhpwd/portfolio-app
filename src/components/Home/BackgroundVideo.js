import React, { useEffect, useRef } from "react";
let bgVideo;

// https://www.amazon.com/drive/v1/nodes/7zdVKb3AQU6FiBAyESKxvw/contentRedirection?querySuffix=%3FvideoTranscodeView%3Dtrue%26y%3D720&ownerId=A2ED9145G3H0AN&cb=1649615247945&groupShareToken=xLbJljPqTCy3dJzMbd9VxA.7873MSVWGwCNWq9bhReGhp

function BackgroundVideo(props){

    // useEffect(()=>{
    //     if(props.renN==2){
    //         bgVideo = document.getElementById("video1");
    //     }
    //     if(props.renN>2){
    //         // bgVideo.currentTime = props.yOff;
    //         console.log('frame='+bgVideo.currentTime+" out of "+bgVideo.duration+" frames.");
    //     }
    // },[props.renN]);

    return(<>
        <div id="set-height"></div>
        <div className="videoHome">
            <video id="video1" muted preload autoPlay loop>
                <source src="https://www.amazon.com/drive/v1/nodes/7zdVKb3AQU6FiBAyESKxvw/contentRedirection?querySuffix=%3FvideoTranscodeView%3Dtrue%26y%3D720&ownerId=A2ED9145G3H0AN&cb=1649615247945&groupShareToken=xLbJljPqTCy3dJzMbd9VxA.7873MSVWGwCNWq9bhReGhp" type="video/mp4; codecs=&quot;avc1.42E01E, mp4a.40.2&quot;" />
            </video>
        </div>
    </>);
}

export default BackgroundVideo;