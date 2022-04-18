// import react variables
import React, { doc, updateDoc, useRef, useState, useEffect } from 'react';
//import firebase utilities
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';



function ActivePoll(props) {

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


  
    // assign properties
    var {a1, a1v, a2, a2v, a3, a3v, a4, a4v, date, duration, question} = props.ActivePoll;
    // create state variable to show post-vote message
    const [showActivePoll, setShowActivePoll] = React.useState(true);
  
  
    var docRef;// variable to store the collection ID
  
    // function to vote on first answer for any poll
    const addVote1 = async (e) => {
      // get the specific document id for the chosen poll
      await firestore.collection("polls").get().then((querrySnapshot) => {
        querrySnapshot.forEach((doc) => {
          if(doc.data().question.toString()===question.toString()){// compares the questions to select correct id
            docRef = doc.id;
          }
        });
      });
      // Add a vote to answer 1 in the chosen document ID
      firestore.collection('polls').doc(docRef.toString()).update({
        a1v:a1v+1,
      })
    };
    // function to vote on second answer for any poll
    const addVote2 = async (e) => {
      // get the specific document id for the chosen poll
      await firestore.collection("polls").get().then((querrySnapshot) => {
        querrySnapshot.forEach((doc) => {
          if(doc.data().question.toString()===question.toString()){// compares the questions to select correct id
            docRef = doc.id;
          }
        });
      });
      // Add a vote to answer 1 in the chosen document ID
      firestore.collection('polls').doc(docRef.toString()).update({
        a2v:a2v+1,
      })
    };
    // function to vote on third answer for any poll
    const addVote3 = async (e) => {
      // get the specific document id for the chosen poll
      await firestore.collection("polls").get().then((querrySnapshot) => {
        querrySnapshot.forEach((doc) => {
          if(doc.data().question.toString()===question.toString()){// compares the questions to select correct id
            docRef = doc.id;
          }
        });
      });
      // Add a vote to answer 1 in the chosen document ID
      firestore.collection('polls').doc(docRef.toString()).update({
        a3v:a3v+1,
      })
    };
    // function to vote on fourth answer for any poll
    const addVote4 = async (e) => {
      // get the specific document id for the chosen poll
      await firestore.collection("polls").get().then((querrySnapshot) => {
        querrySnapshot.forEach((doc) => {
          if(doc.data().question.toString()===question.toString()){// compares the questions to select correct id
            docRef = doc.id;
          }
        });
      });
      // Add a vote to answer 1 in the chosen document ID
      firestore.collection('polls').doc(docRef.toString()).update({
        a4v:a4v+1,
      })
    };
    // function to end poll activity
    const endPoll = async (e) => {
      // get the specific document id for the chosen poll
      await firestore.collection("polls").get().then((querrySnapshot) => {
        querrySnapshot.forEach((doc) => {
          if(doc.data().question.toString()===question.toString()){// compares the questions to select correct id
            docRef = doc.id;
          }
        });
      });
      // set duration = (currenttime - creationdate) for data viewing later. Also makes inactive
      let nowMin = (Math.floor((new Date()-date.toDate())/1000)/60);
      // Pass (currenttime - creationdate) value to duration 
      firestore.collection('polls').doc(docRef.toString()).update({
        duration:nowMin,
      })
    };
  
    const crntTime = new Date()/1000/60; // get current time in minutes
    const postTime = date && date.toDate()/1000/60; // get post time in minutes
    const expTime = postTime + duration; // get expiration date in minutes
    const pollActivity = crntTime < expTime ? true: false;// true if expiration is in future
    const expString = (new Date(expTime*60000)).toLocaleString();
    console.log(expString);
  
  
  
    
  
    // if the poll is active then display the poll in the active polls section
      if(!showActivePoll){
        console.log('voted')
        return(
          <div className='postPollSpace'>
            Thank you for your feedback!
          </div>
        )
    
      }else if(pollActivity){
        return(
          <div className='pollSpace'>
              <div>
              <div id='questions'>{question}</div>
              <button onClick={function(event){addVote1();setShowActivePoll(false)}} className='pollButton' type='button'>{a1}</button>
              <button onClick={function(event){addVote2();setShowActivePoll(false)}} className='pollButton' type='button'>{a2}</button>
              <button onClick={function(event){addVote3();setShowActivePoll(false)}} className='pollButton' type='button'>{a3}</button>
              <button onClick={function(event){addVote4();setShowActivePoll(false)}} className='pollButton' type='button'>{a4}</button>
              <button onClick={endPoll} className='endPollButton' type='button'>End Poll</button>
              <p id='expirations'>Expiration: {expString}</p>
            </div>
          </div>
        )
      }else {return <></>}
}
export default ActivePoll;