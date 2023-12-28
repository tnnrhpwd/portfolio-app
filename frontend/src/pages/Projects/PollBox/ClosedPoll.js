 // import react variables
 import React from 'react';


function ClosedPoll(props) {}

//   firebase.initializeApp({  
//     apiKey: process.env.REACT_APP_FIREBASE_APIKEY,
//     authDomain: process.env.REACT_APP_FIREBASE_AUTHDOMAIN,
//     projectId: process.env.REACT_APP_FIREBASE_PROJECTID,
//     storageBucket: process.env.REACT_APP_FIREBASE_STORAGEBUCKET,
//     messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGINGSENDERID,
//     appId: process.env.REACT_APP_FIREBASE_APPID,
//     measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENTID
//   })

//   const firestore = firebase.firestore();




//   const {a1, a1v, a2, a2v, a3, a3v, a4, a4v, date, duration, question} = props.ClosedPoll;
  
//   const crntTime = new Date(); // get current time
//   const postTime = date && date.toDate().setMinutes( date.toDate().getMinutes() + duration ); // get expiration date
//   const pollActivity = crntTime < postTime ? true : false; // true if expiration is in future
    
//   var docRef;// variable to store the collection ID
//   // function to delete poll
//   const deletePoll = async (e) => {
//     // get the specific document id for the chosen poll
//     await firestore.collection("polls").get().then((querrySnapshot) => {
//       querrySnapshot.forEach((doc) => {
//         if(doc.data().question.toString()===question.toString()){// compares the questions to select correct id
//           docRef = doc.id;
//         }
//       });
//     });
//     // Delete the selected poll from the database.
//     firestore.collection('polls').doc(docRef.toString()).delete();
//   };
  
//   // Data calculations
//   let voteSum=a1v+a2v+a3v+a4v;
//   let a1vPcnt=(100*a1v/voteSum).toFixed(2);
//   let a2vPcnt=(100*a2v/voteSum).toFixed(2);
//   let a3vPcnt=(100*a3v/voteSum).toFixed(2);
//   let a4vPcnt=(100*a4v/voteSum).toFixed(2);
  
//   // if the poll is inactive active then display the poll in the active polls section
//   if(!pollActivity){
//     return(<>
//         <div className='recentBox'>
//           <div id='recentQuestion'>{question}</div>
//           <div className='deletePollButton-space'>
//             <button onClick={deletePoll} className='deletePollButton' type='button'>Delete Poll</button>
//           </div>
//           <div id='recentResults'>Voting Results:</div>
//           <div id='recentData'>
//             <div><div id='recentDataQ'>•{a1}:</div>  <div id='recentDataV'>{a1v} votes</div> <span id='recentDataP' >{`${a1vPcnt}%`}</span> </div> 
//             <div><div id='recentDataQ'>•{a2}:</div>  <div id='recentDataV'>{a2v} votes</div> <span id='recentDataP' >{`${a2vPcnt}%`}</span> </div>
//             <div><div id='recentDataQ'>•{a3}:</div>  <div id='recentDataV'>{a3v} votes</div> <span id='recentDataP' >{`${a3vPcnt}%`}</span> </div> 
//             <div><div id='recentDataQ'>•{a4}:</div>  <div id='recentDataV'>{a4v} votes</div> <span id='recentDataP' >{`${a4vPcnt}%`}</span> </div>
//           </div>
//       </div>
//     </>)
//   } else {return <></>}
// }
export default ClosedPoll;