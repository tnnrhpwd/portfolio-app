import React from "react";
import "./ProdPartners.css";

function Projects() {
    return (<>
        <div className="prodpartners-space">
            <div className="prodpartners-title">
                STH Production Partners
            </div>

            <div className="prodpartners-body">
                Exclusive discord private group chat, content on this website, and more coming in the future!
            </div>
            <div className="prodpartners-get">
                <td id="prodpartners-get-box-right-button" onClick={()=> window.open("https://opensea.io/assets/matic/0x2953399124f0cbb46d2cbacd8a89cf0599974963/7281890970453279585523127748795948151935360281289653927383017054188089639412/", "_blank")}>
                    <div className="prodpartners-get-box">
                        <div className="prodpartners-get-box-left">
                            <img 
                                id="prodpartners-get-box-left-img"
                                src="https://lh3.googleusercontent.com/T5_63oU9lGC0wERUiS2hM88R8wMJnBxzPld2PwerOebD-tvzYlhI4Y_zf8AtwDynTC3-lhH2u-V7_3pxgf33GdVneEkedIhy4XfJ1qs=w600"
                                alt="STH Production Partners"
                            />
                        </div>
                        <div className="prodpartners-get-box-right">
                            <div id="prodpartners-get-box-right-text">
                                Join the community
                            </div>
                            <div id="prodpartners-get-box-right-cost">
                                $5
                            </div>
                        </div>
                    </div>
                </td>
            </div>
            <div className="prodpartners-description">
                Lifetime access following your Web3 wallet address.
            </div>
        </div>
    </>);
  }
  
  export default Projects;

