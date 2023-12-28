import React from "react";

function NavItem(props){
    return(
        <div className="nav-item">
            <a href={props.page} className="icon-button">
                <img src={props.icon} className="nav-icon" alt="the png logos for the links to each webpage"/>
                <div id="nav-icon-text">
                    {props.text}
                </div>
            </a>
        </div>
    );
}

export default NavItem;