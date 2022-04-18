import React from "react";


function NavItem(props){
    return(
        <li className="nav-item">
            <a href={props.page} className="icon-button">
                <img src={props.icon} className="nav-icon" alt="the png logos for the links to each webpage"/>
            </a>
        </li>
    );
}

export default NavItem;