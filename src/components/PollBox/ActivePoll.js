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
  
    // Data calculations
    let voteSum=a1v+a2v+a3v+a4v;
    let a1vPcnt=(100*a1v/voteSum).toFixed(2);
    let a2vPcnt=(100*a2v/voteSum).toFixed(2);
    let a3vPcnt=(100*a3v/voteSum).toFixed(2);
    let a4vPcnt=(100*a4v/voteSum).toFixed(2);
  
  
    
  
    // if the poll is active then display the poll in the active polls section
      if(!showActivePoll){
        console.log('voted')
        return(
          <div className='postPollSpace'>
            <button onClick={endPoll} className='endPollButton' type='button'>End Poll</button>
            <div id='recentQuestion'>{question}</div>
            <div id='recentResults'>Voting Results:</div>
            <div id='recentData'>
              <div><div id='recentDataQ'>•{a1}:</div>  <div id='recentDataV'>{a1v} votes</div> <span id='recentDataP' >{`${a1vPcnt}%`}</span> </div> 
              <div><div id='recentDataQ'>•{a2}:</div>  <div id='recentDataV'>{a2v} votes</div> <span id='recentDataP' >{`${a2vPcnt}%`}</span> </div>
              <div><div id='recentDataQ'>•{a3}:</div>  <div id='recentDataV'>{a3v} votes</div> <span id='recentDataP' >{`${a3vPcnt}%`}</span> </div> 
              <div><div id='recentDataQ'>•{a4}:</div>  <div id='recentDataV'>{a4v} votes</div> <span id='recentDataP' >{`${a4vPcnt}%`}</span> </div>
            </div>
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