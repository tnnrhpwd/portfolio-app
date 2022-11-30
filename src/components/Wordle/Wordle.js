import React, { useEffect, useState } from 'react';
import NavBar from './../NavBar/NavBar';
import Footer from './../Footer/Footer';
import url from "./../WordleSolver/Dictionary.txt";
import "./Wordle.css";

var keys = { //create dictionary object to store pairs of keys and result(correct, found, wrong).
  'Q': '', 'W': '', 'E': '', 'R': '', 'T': '', 'Y': '', 'U': '', 'I': '', 'O': '', 'P': '', 'break': '',
  'A': '', 'S': '', 'D': '', 'F': '', 'G': '', 'H': '', 'J': '', 'K': '', 'L': '', 'break2': '',
  'enter': '', 'Z': '', 'X': '', 'C': '', 'V': '', 'B': '', 'N': '', 'M': '', '⌫': ''
};

// bugs to fix
// 1 keyboard letters greyed out when should be yellow.

var Dictionary=[];
var guesses = []; // array full of user previous guesses
var currentGuess = []; // array full of chars of current guess
var wordLength=0;
var secretWord="";
var buttonPressNum=0;
var maxGuesses = 6;
const Correct = 'correct'; 
const Found = 'found';
const Wrong = 'wrong';

// Main function component
function Wordle() {
  const [inGameState, setInGameState] = useState(0);
  const [settingMenu, setSettingMenu] = useState(0);
  const [settingMenuText, setSettingMenuText] = useState("");
  const [outputMessage, setOutputMessage] = useState("");
  const [answerVisibility,setAnswerVisibility ]= useState(false);

  function resetInitialValues(){
    keys = { 
      'Q': '', 'W': '', 'E': '', 'R': '', 'T': '', 'Y': '', 'U': '', 'I': '', 'O': '', 'P': '', 'break': '',
      'A': '', 'S': '', 'D': '', 'F': '', 'G': '', 'H': '', 'J': '', 'K': '', 'L': '', 'break2': '',
      'enter': '', 'Z': '', 'X': '', 'C': '', 'V': '', 'B': '', 'N': '', 'M': '', '⌫': ''
    };
    guesses = []; // array full of user previous guesses
    currentGuess = []; // array full of chars of current guess
    wordLength=0;
    secretWord="";
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

  // fills the dictionary with words
  function fetchDictionary() {
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
    console.log(Dictionary)
  }

  // fills the dictionary array with words on the intial load.
  useEffect(() => {
    fetchDictionary();
    startKeyListen();
  }, []);

  function keyListener(event){
    //GUARD CLAUSE - paste number into settings input
    if(event.code===undefined){}
    else if(event.code.length===4){ //if key was a letter
      keyPress(event.code.substring(3,4));
      // setOutputMessage(event.code.substring(3,4));
    }
    switch(event.code){ //if key was not a letter
      case 'Backspace': backspace(); break;
      case 'Enter': enter(); break;
      //case 'Space': revealSolution(); 
      default:break;
    }
  }

  const startKeyListen = () => {
    document.addEventListener('keydown', keyListener, false);
    console.log("Now listening for keyboard inputs")
  }
  
  const newGameButton = () => {

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

    let wordSet=false;
    // stop guessing random words when a word matches the settings.
    while(!wordSet){
      secretWord = Dictionary[(((Math.random()*Dictionary.length+1)) | 0)]; // random word in list
      if((settingMenuText==="")||(parseFloat(settingMenuText)===secretWord.length)){    // if no desired wordlength or secretword length equals desired word length
        wordLength = secretWord.length;
        wordSet=true;
      }
    }
  }

  const toggleSettings = () => {
    setSettingMenu(settingMenu+1);
  }

  const endOfGame = () => {
    
    setAnswerVisibility(true);

  }

  // useEffect(() => {
  //   console.log("game state="+inGameState)
  // },[inGameState])

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
    return grid;
  }

  function keyPress(key){
    switch(key){
      case '⌫': // if typed button was backspace
        backspace(); 
        break; 
      case 'enter': // if typed button was enter
        enter();
        break;
      default:
        // console.log(key);
        // console.log(currentGuess.length);
        // console.log(guesses.length);
        // console.log(wordLength);
        if (currentGuess.length < wordLength 
          && guesses.length < maxGuesses) { //enough letters typed && game still active
            currentGuess.push({ key: key, result: '' }); //adds letter object to currentGuess array
            publishCurrentGuess(); // places the letter on the game grid
        }
    }
  }

  function backspace() {
    //GUARD CLAUSE - empty
    if(currentGuess.length===0){return}
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
    if (!(Dictionary.includes(guessString))){ // if guess is not a word, enter button wont work
      return // ends the method execution before results can be assigned.
    }

    currentGuess.forEach((keyGuess, index) => { //   FOR EACH LETTER    -assigns the outcomes of each guess letter to the respective key then outputs to keys dictionary
      if (secretWord.charAt(index) === keyGuess.key) { //if input key matches letter of answer
        keyGuess.result = Correct;
      } 
      else if (secretWord.includes(keyGuess.key)) { // if input key is in the answer at all
        let CRTappearances=0;                                  //how many of that letter is correct
        for(let xf=0;xf<guessString.length;xf++){    // counts how many of that letter are correctly placed in the word
          if (guessString.charAt(xf)===keyGuess.key&&secretWord.charAt(xf)===keyGuess.key){
            CRTappearances++; // It needed to be able to see future letters before assigning yellow
          }
        };
        if((countLetters(keyGuess.key,secretWord)>CRTappearances) // if not correctly used later && not too many used already
        &&(countLetters(keyGuess.key,secretWord)>countLetters(keyGuess.key,guessString.substring(0,index)))){
          
          keyGuess.result = Found; // assigns result to the letter object in the keys dictionary
          
        }else{keyGuess.result = Wrong;} // assigns result to the letter object in the keys array
        
      } else {keyGuess.result = Wrong;} // else is wrong


      // if (keys[keyGuess.key] !== Correct) {  // if key is BLACK, update it every guess.
      //   keys[keyGuess.key] = keyGuess.result;  // updates the keys dictionary with results from currentGuess
      // }
      // update keys | BLACK -> GREEN + ORANGE | ORANGE -> GREEN
      if ((keys[keyGuess.key] === Wrong)||(keys[keyGuess.key] === "")) {  // if key is BLACK || if key is unassigned, update it every guess.
        keys[keyGuess.key] = keyGuess.result;  // updates the keys dictionary with results from currentGuess
      }
      if ((keys[keyGuess.key] === Found) && (keyGuess.result === Correct)) {  // if key is ORANGE && if key is being updated to GREEN, update it.
        keys[keyGuess.key] = keyGuess.result;  // updates the keys dictionary with results from currentGuess
      } 
      
    });

    if((guessString===secretWord)||(guesses.length>(maxGuesses-2))){ //if WON or LOST, clear the board, print the answer, and reset the board
      setOutputMessage("Thanks for playing!"); // print the answer
      endOfGame();
      // resetGameBoard(); // reset game
    }
    
    publishCurrentGuess(true); // outputs the found/correct tags to letters in guessgrid + executes updatekeyboard()
    guesses.push(currentGuess); // add guess to previous guesses array
    currentGuess = []; // clear the current guess

  }

  function publishCurrentGuess(guessed = false){
    let row = guesses.length;
    for (let i = 0; i<wordLength; i++){
      let keyID = document.getElementById(row+"-"+i);
      // console.log(`${row}${i}`);
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
    <div>
      <NavBar/>
      <div className='wordle-space' id='wordle-space'>
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
            The answer is {secretWord}.
          </div>
        }  
        <div className="keyboard">
          {(inGameState%2===1)&&
            <div key="keyboard-div1">
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
          {(inGameState%2===0||answerVisibility)?
            <button id="automate-newBut" onClick={newGameButton} >
            New Game
            </button>:
            <button id="automate-solutionBut" onClick={endOfGame} >
            Reveal Solution
            </button>
          }
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
      </div>
      <Footer/>
    </div>
    
  );
}

export default Wordle