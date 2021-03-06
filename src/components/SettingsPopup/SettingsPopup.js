import React from "react";
import "./SettingsPopup.css";


const SettingsPopup = ({ isShowLogin }) => {

    return(
        <div className={`${!isShowLogin ? "active" : ""} show`}>
            <div className="login-form">
                <div className="form-box solid">
                    <form>
                        <div 
                            className="login-text">
                            
                        </div>
                        <input 
                            id="login-out"
                            type="submit" 
                            value="Dark Mode" 
                            className="login-btn" 
                        />
                        {/* <input 
                            id="login-connect"
                            type="submit" 
                            value="Connect Wallet" 
                            className="login-btn" 
                        />
                        <input 
                            id="login-out"
                            type="submit" 
                            value="Log Out" 
                            className="login-btn" 
                        /> */}
                    </form>
                </div>
            </div>
        </div>
    );
}

export default SettingsPopup;