import ReactTooltip from "react-tooltip";
import React from 'react';

const logos = {
  code: { img: require("../../assets/github.png"), tip: "Source Code" },
  html: { img: require("../../assets/html.png"), tip: "HTML" },
  react: { img: require("../../assets/react.png"), tip: "React JavaScript" },
  css: { img: require("../../assets/css.png"), tip: "CSS" },
  firebase: { img: require("../../assets/firebase.png"), tip: "Google Firebase" },
  heroku: { img: require("../../assets/heroku.png"), tip: "Heroku" },
  mongo: { img: require("../../assets/mongo.png"), tip: "MongoDB" },
  node: { img: require("../../assets/node.png"), tip: "NodeJS" },
  netlify: { img: require("../../assets/netlify.png"), tip: "Netlify" },
};

function Utility({ type, tips = true, url }) {
  const { img: LogoImg, tip } = logos[type] || {};

  if (!LogoImg) return null;

  return (
    <>
      <div className="projects-logos-div" data-tip="" data-for={`projects-${type}-tip`}>
        {url ? (
          <a href={url} rel="noopener noreferrer" target="_blank">
            <img className="projects-logos" id={`projects-${type}`} src={LogoImg} alt={`${type} logo`} />
          </a>
        ) : (
          <img className="projects-logos" src={LogoImg} alt={`${type} logo`} />
        )}
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
