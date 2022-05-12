import ReactTooltip from "react-tooltip";

import htmlimg from "./html.png";
import reactimg from "./react.png";
import firebaseimg from "./firebase.png";
import cssimg from "./css.png";
import netlifyimg from "./netlify.png";

function Utility(props) {
    var showTips;

    switch(props.tips){
        case true:
            showTips = true;break;
        case false:
            showTips = false;break;
        default:
            showTips = true;break;
    }

    switch(props.type) {
        case "html":
            return (<>
                <div className="projects-logos-div" data-tip="" data-for="projects-html-tip">
                    <img className="projects-logos" src={htmlimg} alt="html logo"/>
                </div>
                {showTips && 
                    <ReactTooltip id="projects-html-tip" place="bottom" effect="solid">
                        <div className="projects-tip-words"> HTML</div>
                    </ReactTooltip>
                }
            </>);
        case "react":
            return (<>
                <div className="projects-logos-div" data-tip="" data-for="projects-react-tip">
                    <img className="projects-logos" src={reactimg} alt="reactjs logo"/>
                </div>
                {showTips && 
                    <ReactTooltip id="projects-react-tip" place="bottom" effect="solid">
                        <div className="projects-tip-words"> React JavaScript</div>
                    </ReactTooltip>
                }
            </>);
        case "css":
            return (<>
                <div className="projects-logos-div" data-tip="" data-for="projects-css-tip">
                    <img className="projects-logos" src={cssimg} alt="css logo"/>
                </div>
                {showTips && 
                    <ReactTooltip id="projects-css-tip" place="bottom" effect="solid">
                    <div className="projects-tip-words"> CSS</div>
                    </ReactTooltip>
                }
            </>);
        case "firebase":
            return (<>
                <div className="projects-logos-div" data-tip="" data-for="projects-firebase-tip">
                    <img className="projects-logos" src={firebaseimg} alt="firebase logo"/>
                </div>
                {showTips &&
                    <ReactTooltip id="projects-firebase-tip" place="bottom" effect="solid">
                        <div className="projects-tip-words"> Google Firebase</div>
                    </ReactTooltip>
                }
            </>);
        case "netlify":
            return (<>
                <div className="projects-logos-div" data-tip="" data-for="projects-netlify-tip">
                    <img className="projects-logos" src={netlifyimg} alt="netlify logo"/>
                </div>
                {showTips &&
                    <ReactTooltip id="projects-netlify-tip" place="bottom" effect="solid">
                        <div className="projects-tip-words"> Netlify</div>
                    </ReactTooltip>
                }
            </>);
        default:
            return;
    }

}

export default Utility