import React from "react";
import "./LoginForm.css";


const LoginForm = ({ isShowLogin }) => {

    return(
        <div className={`${!isShowLogin ? "active" : ""} show`}>
            <div className="login-form">
                <div className="form-box solid">
                    <form>
                        <div 
                            className="login-text">
                            (Coming Soon!)
                        </div>
                        <input 
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
                        />
                    </form>
                </div>
            </div>
        </div>
    );
}

export default LoginForm;