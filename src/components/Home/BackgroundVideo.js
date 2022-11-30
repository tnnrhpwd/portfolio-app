import React from "react";


// https://www.amazon.com/drive/v1/nodes/7zdVKb3AQU6FiBAyESKxvw/contentRedirection?querySuffix=%3FvideoTranscodeView%3Dtrue%26y%3D720&ownerId=A2ED9145G3H0AN&cb=1649615247945&groupShareToken=xLbJljPqTCy3dJzMbd9VxA.7873MSVWGwCNWq9bhReGhp

function BackgroundVideo(props){

    let autoplay = false;
    window.onload = addAutoplay();
    function addAutoplay(){
        if(window.matchMedia("(orientation: landscape)").matches) {
            autoplay=true;
        }
    }

    if(autoplay) {
        return(<>
            <div id="set-height"></div>
            <div className="videoHome">
                <video id="video1" muted loop autoPlay  >
                    <source src="https://www.amazon.com/drive/v1/nodes/7zdVKb3AQU6FiBAyESKxvw/contentRedirection?querySuffix=%3FvideoTranscodeView%3Dtrue%26y%3D720&ownerId=A2ED9145G3H0AN&cb=1649615247945&groupShareToken=xLbJljPqTCy3dJzMbd9VxA.7873MSVWGwCNWq9bhReGhp" type="video/mp4; codecs=&quot;avc1.42E01E, mp4a.40.2&quot;" />
                </video>
            </div>
        </>);
    } else {
        return(<>
            <div id="set-height"></div>
            <div className="videoHome">
                <video id="video1" muted loop preload="none" >
                    <source src="https://www.amazon.com/drive/v1/nodes/7zdVKb3AQU6FiBAyESKxvw/contentRedirection?querySuffix=%3FvideoTranscodeView%3Dtrue%26y%3D720&ownerId=A2ED9145G3H0AN&cb=1649615247945&groupShareToken=xLbJljPqTCy3dJzMbd9VxA.7873MSVWGwCNWq9bhReGhp" type="video/mp4; codecs=&quot;avc1.42E01E, mp4a.40.2&quot;" />
                </video>
            </div>
        </>);
    }
}

export default BackgroundVideo;