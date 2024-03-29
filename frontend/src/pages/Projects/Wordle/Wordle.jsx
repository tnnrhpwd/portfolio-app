import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import url from "./../WordleSolver/Dictionary.txt";
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom'              // page redirects
import { updateData, getData, resetDataSlice, deleteData } from '../../../features/data/dataSlice.js';
import "./Wordle.css";

var keys = { //create dictionary object to store pairs of keys and result(correct, found, wrong).
  'Q': '', 'W': '', 'E': '', 'R': '', 'T': '', 'Y': '', 'U': '', 'I': '', 'O': '', 'P': '', 'break': '',
  'A': '', 'S': '', 'D': '', 'F': '', 'G': '', 'H': '', 'J': '', 'K': '', 'L': '', 'break2': '',
  '⏎': '', 'Z': '', 'X': '', 'C': '', 'V': '', 'B': '', 'N': '', 'M': '', '⌫': ''
};
// ⏎⌫
var Dictionary=[];
var guesses = []; // array full of user previous guesses
var currentGuess = []; // array full of chars of current guess
var wordLength=0;
var buttonPressNum=0;
var maxGuesses = 6;
const Correct = 'correct'; 
const Found = 'found';
const Wrong = 'wrong';

function Wordle() {// Main function component
  const navigate = useNavigate() // initialization
  const dispatch = useDispatch();
  const [secretWord, setSecretWord] = useState("");
  const [definition, setDefinition] = useState("");
  const [inGameState, setInGameState] = useState(0);
  const [settingMenu, setSettingMenu] = useState(0);
  const [settingMenuText, setSettingMenuText] = useState("5");
  const [outputMessage, setOutputMessage] = useState("");
  const [answerVisibility,setAnswerVisibility ]= useState(false);
  const rootStyle = window.getComputedStyle(document.body);
  const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);

  const { user, data, dataIsSuccess, dataIsLoading, dataIsError, dataMessage, operation } = useSelector(  // Get the relevant data from the state
    (state) => state.data
  );

  function resetInitialValues(){
    keys = { 
      'Q': '', 'W': '', 'E': '', 'R': '', 'T': '', 'Y': '', 'U': '', 'I': '', 'O': '', 'P': '', 'break': '',
      'A': '', 'S': '', 'D': '', 'F': '', 'G': '', 'H': '', 'J': '', 'K': '', 'L': '', 'break2': '',
      '⌫': '', 'Z': '', 'X': '', 'C': '', 'V': '', 'B': '', 'N': '', 'M': '', '⏎': ''
    };
    guesses = []; // array full of user previous guesses
    currentGuess = []; // array full of chars of current guess
    wordLength=0;
    setSecretWord("");
    buttonPressNum=0;
    setAnswerVisibility(false);

    for (const key in keys) { // for each key object
      let keyElement = document.getElementById(key); //assigns key ID of each key in loop
      if(keyElement != null){
        keyElement.className = ''; // removes all classes  from the key
        keyElement.classList.add('key'); // re-adds the key CLASS - makes key square, sets pixels, etc.
      }
    }
  }

  function fetchDictionary() {  // fills the dictionary with words
    fetch(url)
    .then(response => response.text())
    .then(data => {
        Dictionary=data.toUpperCase();
        Dictionary=Dictionary.split('\r\n');            // this works local but not in-build
        if(!(Dictionary[0]==="AA")){                    
            Dictionary=Dictionary[0].split("\n");       // backup splitter for in-build
        }
    })
    .catch(err => console.log(err));
  }

  async function getMyData() {  // Function to handle fetching data from the backend
    try {
      // Call the getData action to fetch data
      console.log("Call the getData action to fetch your experience");
      await dispatch(getData({ data: "Word:" }));
    } catch (error) {
      console.error(error);
      toast.error(error, { autoClose: toastDuration });
    }
  }

  function loginWelcome() {
    if (user) {
      toast.success(`Welcome back, ${user.nickname}!`, { autoClose: toastDuration });
    } else {
      toast.info('Welcome! Please login to play. This page uses an api with tracked usage.', { autoClose: 4000 });
    }
  }

  useEffect(() => {
    const launchTimer = setTimeout(() => {
      // Your initialization logic (e.g., fetchDictionary, startKeyListen, etc.)
      fetchDictionary();
      startKeyListen();
      getMyData();
      loginWelcome();
    }, 50); // 0.05 second delay
  
    return () => {
      document.body.removeEventListener('keydown', keyListener);
      clearTimeout(launchTimer); // Cleanup: Cancel the timer if the component unmounts
    };
  }, []);

  useEffect(()=>{
    if (dataMessage && !dataMessage.includes('token')) {
      if(dataMessage.includes('getdef'))
      toast.error("We're sorry. Connection to the definition API has failed", { autoClose: toastDuration });
    }
    // return () => {
    // resetDataSlice()
    // };
  },[dataIsError]
  )

  function keyListener(event){
    if(event.code===undefined){}    //GUARD CLAUSE - paste number into settings input
    else if(event.code.length===4){ //if key was a letter
      keyPress(event.code.substring(3,4));
    }
    switch(event.code){ //if key was not a letter
      case 'Backspace': backspace(); break;
      case 'Enter': enter(); break;
      case '⏎': enter(); break;
      default:break;
    }
  }

  const startKeyListen = () => {
    document.addEventListener('keydown', keyListener, false);
    console.log("Now listening for keyboard inputs")
  }
  
  async function fetchRandomWordFromBackend(wordLength) {  // Function to fetch random word from backend using getData
    try {
      console.log("Calling Word API...")
      await dispatch(getData({ data: `getword:${wordLength}` })); // Dispatch the getData action
    } catch (error) {
      console.error('Error Calling Word API:', error.message);
      throw error;
    }
  }
  
  useEffect(() => {// Run the effect whenever `data` changes
    console.log("State data has been updated:")
    console.log(data)
    if(data && data.word){
      const secretTimer = setTimeout(() => {
        console.log("XXXXXXXXX Secret Word updated.");
        console.log(data.word);
        setSecretWord(data.word);
        fetchDefinition(data.word);
        
      }, 50); // 0.05 second delay
      return () => {
        clearTimeout(secretTimer); // Cleanup: Cancel the timer if the component unmounts
      };
    }
    if(data && data.worddef){
      const defTimer = setTimeout(() => {
        console.log("XXXXXXXXX Definition updated.");
        console.log(data.worddef);
        setDefinition(data.worddef);
        
      }, 50); // 0.05 second delay
      
      return () => {
        clearTimeout(defTimer); // Cleanup: Cancel the timer if the component unmounts
      };
    }
  }, [data]
  )

  async function fetchDefinition(word) {
    try {
      console.log(`Fetching definition for ${word}...`);
      await dispatch(getData({ data: `getdef:${word}` }));
    } catch (error) {
      console.error('Error fetching definition:', error.message);
      throw error;
    }
  }

  async function newGameButton() {
    // GUARD CLAUSE - only numbers OR empty
    if (!(/^\d+$/.test(settingMenuText))) {
      if (!(settingMenuText==="")){
        setOutputMessage("Please enter a number in the text field.");
        return;
      }
    }
    // GUARD CLAUSE - wordlength over 15 letters
    if (parseFloat(settingMenuText)>15){
      setOutputMessage("Please reduce the wordlength.");
        return;
    }
    // GUARD CLAUSE - wordlength under 3 letters
    if (parseFloat(settingMenuText)<3){
      setOutputMessage("Please increase the wordlength.");
        return;
    }
    resetInitialValues();

    setOutputMessage("");
    buttonPressNum++;

    setInGameState(1);

    try {
      // Call the backend endpoint to fetch the random word
      console.log(settingMenuText);
      wordLength = parseFloat(settingMenuText);
      await fetchRandomWordFromBackend(wordLength);

      // the code below is the intermediate code before i can get a good wordAPI
      // let tempSecretWord;
      // let wordSet=false;
      // while(!wordSet){
      //   tempSecretWord = Dictionary[(((Math.random()*Dictionary.length+1)) | 0)]; // random word in list
      //   if((settingMenuText==="")||(parseFloat(settingMenuText)===secretWord.length)){    // if no desired wordlength or secretword length equals desired word length
      //     wordLength = secretWord.length;
      //     wordSet=true;
      //   }
      // }
      // setSecretWord(tempSecretWord)
      // fetchDefinition(tempSecretWord);

    } catch (error) {
      console.error('Error fetching random word:', error.message);
      setOutputMessage('Error fetching random word. Please try again later.');
    }


  }

  const toggleSettings = () => {
    setSettingMenu(settingMenu+1);
  }

  const endOfGame = async () => {  // Function to handle end of game
    // Other code...
    setAnswerVisibility(true);

    try {
      setOutputMessage(`The answer is ${secretWord}. Definition: ${definition}`);
    } catch (error) {
      console.error('Error fetching definition:', error.message);
      setOutputMessage(`The answer is ${secretWord}. Definition not available.`);
    }
  };

  function updateKeyGuessCount(numCharacters) {
    numCharacters = parseInt(numCharacters);
    if (isNaN(numCharacters)) {
        console.error('Invalid number of characters');
        return;
    }
    document.documentElement.style.setProperty('--key-guess-count', `${numCharacters}`);
}

  function GetGuessGrid(){
    let grid = [];
    for(let i = 0; i < maxGuesses; i++){     // number of guesses
      for(let j = 0; j < wordLength; j++){   // word length
        let lett = "";
        let lettClass = "key-guess";
        if(guesses[i]){ // if guess exists, place letters on the grid
          lett = guesses[i][j].key;
          lettClass = "key-guess "+guesses[i][j].result;
        }
        grid.push(<div id={i+'-'+j} className={lettClass} key={i+'-'+j}>{lett}</div>)
      }
      grid.push(<br key={i}/>)
    }
    updateKeyGuessCount(wordLength);    // Call this function with the number of letters in the word
    return grid;
  }

  function keyPress(key){
    switch(key){
      case '⌫': // if typed button was backspace
        backspace(); 
        break; 
      case '⏎': // if typed button was enter
        enter();
        break;
      default:
        if (currentGuess.length < wordLength 
          && guesses.length < maxGuesses) { //enough letters typed && game still active
            currentGuess.push({ key: key, result: '' }); //adds letter object to currentGuess array
            publishCurrentGuess(); // places the letter on the game grid
        }
    }
  }

  function backspace() {
    if(currentGuess.length===0){return}    //GUARD CLAUSE - empty
    currentGuess.pop();
    publishCurrentGuess();
  }

  function countLetters(strng1,strng2){ //returns count of times strng1 appears in strng2. .count(char) was not working for me
    let appearances=0;
    for(let xf=0;xf<strng2.length;xf++){
      if (strng2.charAt(xf)===strng1){
        appearances++;
      }
    };
    return appearances;
  };

  function enter() {
    // GUARD CLAUSE - enough letters and lives
    if (currentGuess.length < wordLength || guesses.length >= maxGuesses) { //if guess is too short or out of lives, then enter button wont work.
      return;
    }
    var guessString=""; // creates a guess string 
    currentGuess.forEach((keyGuess, index) => { // extracts the string from the letter objects in the currentGuess array 
      guessString =guessString + keyGuess.key
    });
    // GUARD CLAUSE - not a word
    if (!(Dictionary.includes(guessString) || guessString.toLowerCase() === secretWord)) { // if guess is not a word, enter button wont work
      toast.info('That is not a word. Please try again.', { autoClose: toastDuration });
      return // ends the method execution before results can be assigned.
    }

    currentGuess.forEach((keyGuess, index) => { //   FOR EACH LETTER    -assigns the outcomes of each guess letter to the respective key then outputs to keys dictionary
      console.log("Secret Word:", secretWord, typeof secretWord);
      console.log("Key Guess:", keyGuess.key);
      const lowKeyGuess = keyGuess.key.toLowerCase()
      if (secretWord.charAt(index).toLowerCase() === lowKeyGuess) { // Convert secretWord character to lowercase for comparison
        keyGuess.result = Correct;
      } else if (secretWord.toLowerCase().includes(lowKeyGuess)) { // Convert secretWord to lowercase for checking inclusion
        let CRTappearances = 0;
        for (let xf = 0; xf < guessString.length; xf++) {
          if (guessString.charAt(xf).toLowerCase() === lowKeyGuess && secretWord.charAt(xf).toLowerCase() === lowKeyGuess) {
              CRTappearances++;
          }
        } if (countLetters(lowKeyGuess, secretWord) > CRTappearances && countLetters(lowKeyGuess, secretWord) > countLetters(lowKeyGuess, guessString.substring(0, index))) {
          keyGuess.result = Found;
        } else {
          keyGuess.result = Wrong;
        }
      } else {
        keyGuess.result = Wrong;
      }

      // update keys | BLACK -> GREEN + ORANGE | ORANGE -> GREEN
      if ((keys[keyGuess.key] === Wrong)||(keys[keyGuess.key] === "")) {  // if key is BLACK || if key is unassigned, update it every guess.
        keys[keyGuess.key] = keyGuess.result;  // updates the keys dictionary with results from currentGuess
      }
      if ((keys[keyGuess.key] === Found) && (keyGuess.result === Correct)) {  // if key is ORANGE && if key is being updated to GREEN, update it.
        keys[keyGuess.key] = keyGuess.result;  // updates the keys dictionary with results from currentGuess
      } 
      
    });

    if((guessString.toLowerCase()===secretWord)||(guesses.length>(maxGuesses-2))){ //if WON or LOST, clear the board, print the answer, and reset the board
      setOutputMessage("Thanks for playing!"); // print the answer
      endOfGame();
    }
    
    publishCurrentGuess(true); // outputs the found/correct tags to letters in guessgrid + executes updatekeyboard()
    guesses.push(currentGuess); // add guess to previous guesses array
    currentGuess = []; // clear the current guess
  }

  function publishCurrentGuess(guessed = false){
    let row = guesses.length;
    for (let i = 0; i<wordLength; i++){
      let keyID = document.getElementById(row+"-"+i);
      if (currentGuess[i]) { // if letter in currentGuess exist, put it on the board
        keyID.innerHTML = currentGuess[i].key;
      }else { // if no letter in current guess, fill guess grid with ''
        keyID.innerHTML = '';
      }
      if (guessed) {   //GUESS == TRUE
        keyID.classList.add(currentGuess[i].result); //outputs the found/correct tags to letters in guessgrid
        if (i===wordLength-1){publishKeyboard()} // sends results to keyboard IDs on last letter
      }
    }
  }

  function publishKeyboard() { // FOR EACH GUESS KEY - clears CLASS, adds updated CLASS, and re-adds key CLASS
    for (const key in keys) { // for each key object
      if (!(keys[key] === '')) { // keys that contains results
        let keyElement = document.getElementById(`${key}`); //assigns key ID of each key in loop
        keyElement.className = ''; // removes all classes from the key
        keyElement.classList.add(keys[key]); // adds the keyGuess.result CLASS to the respective key - makes keys yellow/green/black
        keyElement.classList.add('key'); // re-adds the key CLASS - makes key square, sets pixels, etc.
      }
    }
  }

  return (
    <div className='wordle-space' id='wordle-space'>
      <Header/>
      <div className="title">
        Wordle
      </div>
      <div className="guessGrid">
        <GetGuessGrid/>
        <div/>
        {(buttonPressNum===0)&&"Press New Game to begin!"}
      </div>
      {(answerVisibility===true)&&
        <div className='wordle-answer'>
          {outputMessage}
        </div>
      }  
      <div className="keyboard">
        {(inGameState%2===1)&&
          <div className="keyboard-div1" key="keyboard-div1">
            {Object.keys(keys).map((key,index) => (
              <div className='keyboard-div2' key={"keyboard-div2"+key}>
                {(key.includes("break"))?<br key={index} />:
                  <button id={key} onClick={() => keyPress(key)} className='key' key={key} >{key}</button>
                }
              </div>
            ))}
          </div>
        }
      </div>
      <div className="automate">
      {user ? (
        (inGameState % 2 === 0 || answerVisibility) ? (
          <button id="automate-newBut" onClick={newGameButton}>
            New Game
          </button>
        ) : (
          <button id="automate-solutionBut" onClick={endOfGame}>
            Reveal Solution
          </button>
        )
      ) : (
        <button id="automate-newBut" onClick={() => navigate('/login')}>
          New Game
        </button>
      )}

        <button id="automate-settingBut" onClick={toggleSettings}>
          ⚙
        </button>
        <br></br>
        {(settingMenu%2===1)&&
          <div className='settingMenu'>
            Desired Word Length
            <input type="text" id="settingMenu-text" onChange={e => setSettingMenuText(e.target.value)} value={settingMenuText} />
            <br/>
            <a href="/wordlesolver" target="_blank">
              <button id="automate-solverbut">Open Wordle Solver</button>
            </a>
            <br/>
            <a href="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/Wordle" rel="noopener noreferrer" target="_blank">
              <button id="automate-solverbut">View Source Code</button>
            </a>
          </div>
        }  
      </div>
      <div className="credits">
      {outputMessage}
      </div>
      <Footer/>
    </div>
  );
}

export default Wordle