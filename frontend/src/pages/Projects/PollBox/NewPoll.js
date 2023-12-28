// import react variables
import React, { useState } from 'react';


function NewPoll(){}


//     firebase.initializeApp({  
//       apiKey: process.env.REACT_APP_FIREBASE_APIKEY,
//       authDomain: process.env.REACT_APP_FIREBASE_AUTHDOMAIN,
//       projectId: process.env.REACT_APP_FIREBASE_PROJECTID,
//       storageBucket: process.env.REACT_APP_FIREBASE_STORAGEBUCKET,
//       messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGINGSENDERID,
//       appId: process.env.REACT_APP_FIREBASE_APPID,
//       measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENTID
//     })


//   const firestore = firebase.firestore();




//     // const prevPolls = useRef(); // holds object of current state
//     const pollsData = firestore.collection('polls'); // get polls data from database
  
  
//     const [allValues, setAllValues] = useState({  // make list of variables for text input with update function
//       a1Form:'',
//       a2Form:'',
//       a3Form:'',
//       a4Form:'',
//       durationForm:'',
//       questionForm:'',
//     });
  
  
//     const changeHandler = (e) => {
//       setAllValues({
//         ...allValues, [e.target.name]: e.target.value});
//     };
  
//     const addPoll = async (e) => {
//       e.preventDefault();
  
//       // create a new poll with this data and add it to pollsData
//       await pollsData.add({
//         a1: allValues.a1Form,
//         a1v: 0,
//         a2: allValues.a2Form,
//         a2v: 0,
//         a3: allValues.a3Form,
//         a3v: 0,
//         a4: allValues.a4Form,
//         a4v: 0,
//         date: firebase.firestore.FieldValue.serverTimestamp(), // get time
//         duration: Number(allValues.durationForm),
//         question: allValues.questionForm,
//       })
//       // Sets all the values
//       setAllValues({
//         a1Form:'',
//         a2Form:'',
//         a3Form:'',
//         a4Form:'',
//         durationForm:'',
//         questionForm:'',
//       });
//     }
  
//     return <>
//     <form onSubmit={addPoll}>
//       <div>
//         <input id="questionID" name='questionForm' value={allValues.questionForm} onChange={changeHandler} placeholder="Poll Text" />
//       </div>
//       <div className='newPollSpace'>
//         <input id="newPollEntry" name='a1Form' value={allValues.a1Form} onChange={changeHandler} placeholder="First answer" />
//         <input id="newPollEntry" name='a2Form' value={allValues.a2Form} onChange={changeHandler} placeholder="Second answer" />
//         <input id="newPollEntry" name='a3Form' value={allValues.a3Form} onChange={changeHandler} placeholder="Third answer" />
//         <input id="newPollEntry" name='a4Form' value={allValues.a4Form} onChange={changeHandler} placeholder="Fourth answer" />
//       </div>
//       <div>
//         <input id="durationID" name='durationForm' value={allValues.durationForm} onChange={changeHandler} placeholder="Duration (min)" />
//         <button id="buttonNewPollID" type='submit' disabled={!allValues.questionForm}>Submit Poll</button>
//       </div>
//     </form>
//   </>
// }
export default NewPoll;