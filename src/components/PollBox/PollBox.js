// import react variables
import React, { useState, useEffect } from 'react';

// import axios from 'axios';


// import poll js components
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
const recentTitle="Recent Polls";    // recent polls text



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
    
    // console.log(pollQ)

        return <>
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
            </div>
        </>

}

export default PollBox;