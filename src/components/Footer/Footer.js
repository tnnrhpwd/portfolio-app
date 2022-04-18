import React from "react";
import "./Footer.css";

function Footer(props) {
  if(props.transparent=="1"){
    return (
      <div className="footer-space-transparent">
          Developed by Steven Tanner Hopwood
      </div>
    );
  } else{
    return (
      <div className="footer-space">
          Developed by Steven Tanner Hopwood
      </div>
    );
  }
}
  
  export default Footer;