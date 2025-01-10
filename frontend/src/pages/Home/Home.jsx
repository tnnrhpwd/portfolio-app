import React, { useEffect } from "react";
import Header from "../../components/Header/Header.jsx";
import Footer from "../../components/Footer/Footer.jsx";
import { useSelector, useDispatch } from 'react-redux';
import { getPublicData } from '../../features/data/dataSlice.js';
import './Home.css';

const links = {
    net: "/net",
    agenda: "/agenda",
    admin: "/admin",
    passgen: "/passgen",
    annuities: "/annuities",
    sonic: "/sonic",
    wordle: "/wordle",
    simple: "/simple",
    plans: "/plans"
};

function Home() {
    const dispatch = useDispatch();

    const { user } = useSelector(
        (state) => state.data
    );

    useEffect(() => {
        dispatch(getPublicData({ data: { text: "Action" } })).unwrap();
    }, [dispatch]);

    return (
        <>
            <Header />
            <div className="container">
                <section className="section-tile">
                    <div id="content-tile">
                        <div id="text-title">It's simple.</div>
                        <div id="text-body"> Let's build a brighter tomorrow! </div>
                        <div id="text-subtext"> Manufacturing, Engineering, and Process Development </div>
                        <div id="text-about"><a href="/about">Learn more about us.</a></div>
                    </div>
                </section>
                <section className="section-tile">
                    <div id="content-tile">
                        <div id="text-body"> Pages: </div>
                        <div className="home-spc">
                            {( user && user._id.toString() === '6770a067c725cbceab958619') && 
                                <a className="home-spc-tool" href={links.admin} ><div className="home-spc-tool-text">{links.admin}</div></a>}
                            <a className="home-spc-tool" href={links.passgen} ><div className="home-spc-tool-text">{links.passgen}</div></a>
                            <a className="home-spc-tool" href={links.annuities} ><div className="home-spc-tool-text">{links.annuities}</div></a>
                            {user && <a className="home-spc-tool" href={links.net} ><div className="home-spc-tool-text">{links.net}</div></a>}
                            <a className="home-spc-tool" href={links.plans} ><div className="home-spc-tool-text">{links.plans}</div></a>
                        </div>
                    </div>
                    <div id="content-tile">
                        <div id="text-body"> Apps: </div>
                        <div className="home-spc">
                            <a className="home-spc-tool" href={links.simple}>
                                <div className="home-spc-tool-text">Simple (Windows)</div>
                            </a>
                        </div>
                    </div>
                </section>
                <section className="section-tile">
                    <div id="content-tile">
                        <div id="text-body">Thank you for visiting. </div>
                    </div>
                </section>
                <Footer />
            </div>
        </>
    );
}

export default Home;
