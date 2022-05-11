// import react variables
import React, { useState } from 'react';

// import components
import NavBar from './../NavBar/NavBar';
import Footer from './../Footer/Footer';
import ActivePoll from "./ActivePoll";
import NewPoll from "./NewPoll";
import ClosedPoll from "./ClosedPoll";

// import styling
import './PollBox.css';

//import firebase utilities
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

// import firestore data hooks
import { useCollectionData } from 'react-firebase-hooks/firestore'; 

const activeTitle="Active Polls";   // active polls text
const description="No sign in required. Send the link to your friends!";
const newTitle="Toggle New Poll Visability";      // add new poll text
const recentTitle="Closed Polls";    // recent polls text



// const result = axios.get('.netlify/functions/pollKeys');


function PollBox(){

    firebase.initializeApp({  
        apiKey: process.env.REACT_APP_FIREBASE_APIKEY,
        authDomain: process.env.REACT_APP_FIREBASE_AUTHDOMAIN,
        projectId: process.env.REACT_APP_FIREBASE_PROJECTID,
        storageBucket: process.env.REACT_APP_FIREBASE_STORAGEBUCKET,
        messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGINGSENDERID,
        appId: process.env.REACT_APP_FIREBASE_APPID,
        measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENTID
    })

    const firestore = firebase.firestore();

    const [showNewPoll, setShowNewPoll] = useState(0); //create state variable to toggle new poll visability
        
    const pollsData = firestore.collection('polls'); // get polls data from database
    const pollQ = pollsData.orderBy('date').limit(25); // get list of polls
    const [polls] = useCollectionData(pollQ, { idField: 'id' }); // create array of polls using their id as the key
    


        return (<>
            <NavBar/>
            <div className='pollbox-app'>
                <div>
                    <div className='pollbox-titles'>{activeTitle}</div>
                    <div className='pollbox-descriptions'>{description}</div>
                    {polls && polls.map(pl => <ActivePoll key={pl.id} ActivePoll={pl}/>)}
                </div>
                    
                <div className='pollbox-app-newpoll'>
                    <div  className='pollbox-app-newpoll-div'><button onClick={()=>setShowNewPoll(showNewPoll+1)} id='newTitle' type='button'>{newTitle}</button></div>
                    <div className='newFormSpace'>{(showNewPoll%2)?<NewPoll />:null}</div>
                </div>
                <div className='pollbox-app-closedpoll'>
                    <div className='newFormSpace-title'>{recentTitle}</div>
                    {polls && polls.map(pl => <ClosedPoll key={pl.id} ClosedPoll={pl}/>)}
                </div>
                <a className='poll-source-but' href="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/PollBox" rel="noreferrer" target="_blank">
                    <button id="button">View Source Code</button>
                </a>
            </div>
            <Footer transparent="1" />
        </>)

}

export default PollBox;