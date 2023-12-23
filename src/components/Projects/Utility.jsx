import ReactTooltip from "react-tooltip";
import React from 'react';



function Utility({ type, tips = true, downurl }) {

  const logos = {
    code: { img: require("../../assets/github.png"), tip: "Source Code", url: downurl },
    html: { img: require("../../assets/html.png"), tip: "HTML", url: "https://www.w3.org/html/" },
    react: { img: require("../../assets/react.png"), tip: "React JavaScript", url: "https://reactjs.org/" },
    css: { img: require("../../assets/css.png"), tip: "CSS", url: "https://www.w3.org/Style/CSS/Overview.en.html" },
    firebase: { img: require("../../assets/firebase.png"), tip: "Google Firebase", url: "https://firebase.google.com/" },
    heroku: { img: require("../../assets/heroku.png"), tip: "Heroku", url: "https://www.heroku.com/" },
    mongo: { img: require("../../assets/mongo.png"), tip: "MongoDB", url: "https://www.mongodb.com/" },
    node: { img: require("../../assets/node.png"), tip: "NodeJS", url: "https://nodejs.org/" },
    netlify: { img: require("../../assets/netlify.png"), tip: "Netlify", url: "https://www.netlify.com/" },
  };
  
  const { img: LogoImg, tip, url } = logos[type] || {};

  if (!LogoImg) return null;

  return (
    <>
      <div className="projects-logos-div" data-tip="" data-for={`projects-${type}-tip`}>
        <a href={url} rel="noopener noreferrer" target="_blank">
          <img className="projects-logos" id={`projects-${type}`} src={LogoImg} alt={`${type} logo`} />
        </a>
      </div>
      {tips && (
        <ReactTooltip id={`projects-${type}-tip`} place="bottom" effect="solid">
          <div className="projects-tip-words">{tip}</div>
        </ReactTooltip>
      )}
    </>
  );
}

export default Utility;