import ReactTooltip from "react-tooltip";
import React from 'react';
import codeimg from "./github.png";
import htmlimg from "./html.png";
import reactimg from "./react.png";
import firebaseimg from "./firebase.png";
import cssimg from "./css.png";
import netlifyimg from "./netlify.png";
import herokuimg from "./heroku.png";
import mongoimg from "./mongo.png";
import nodeimg from "./node.png";

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
        case "code":
            return (<>
                <div className="projects-logos-div" data-tip="" data-for="projects-code-tip">
                    <a href={props.url}  rel="noreferrer" target="_blank">
                        <img className="projects-logos" id="projects-code" src={codeimg} alt="source code logo"/>
                    </a>
                </div>
                {showTips && 
                    <ReactTooltip id="projects-code-tip" place="bottom" effect="solid">
                        <div className="projects-tip-words"> Source Code</div>
                    </ReactTooltip>
                }
            </>);
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
        case "heroku":
            return (<>
                <div className="projects-logos-div" data-tip="" data-for="projects-heroku-tip">
                    <img className="projects-logos" src={herokuimg} alt="heroku logo"/>
                </div>
                {showTips &&
                    <ReactTooltip id="projects-heroku-tip" place="bottom" effect="solid">
                        <div className="projects-tip-words"> Heroku</div>
                    </ReactTooltip>
                }
            </>);
        case "mongo":
            return (<>
                <div className="projects-logos-div" data-tip="" data-for="projects-mongo-tip">
                    <img className="projects-logos" src={mongoimg} alt="mongo logo"/>
                </div>
                {showTips &&
                    <ReactTooltip id="projects-mongo-tip" place="bottom" effect="solid">
                        <div className="projects-tip-words"> MongoDB</div>
                    </ReactTooltip>
                }
            </>);
        case "node":
            return (<>
                <div className="projects-logos-div" data-tip="" data-for="projects-node-tip">
                    <img className="projects-logos" src={nodeimg} alt="node logo"/>
                </div>
                {showTips &&
                    <ReactTooltip id="projects-node-tip" place="bottom" effect="solid">
                        <div className="projects-tip-words"> NodeJS</div>
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