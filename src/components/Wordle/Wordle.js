import React, { useEffect, useState } from 'react';
import Footer from './../Footer/Footer';
import url from "./../WordleSolver/Dictionary.txt";
import "./Wordle.css";
import _ from "lodash";

let keys = { //create dictionary object to store pairs of keys and result(correct, found, wrong).
  'Q': '', 'W': '', 'E': '', 'R': '', 'T': '', 'Y': '', 'U': '', 'I': '', 'O': '', 'P': '', 'break': '',
  'A': '', 'S': '', 'D': '', 'F': '', 'G': '', 'H': '', 'J': '', 'K': '', 'L': '', 'break2': '',
  'enter': '', 'Z': '', 'X': '', 'C': '', 'V': '', 'B': '', 'N': '', 'M': '', '⌫': ''
};

const looosss = ['house','car','frog']

var Dictionary=[];
var guesses = []; // array full of user previous guesses
var currentGuess = []; // array full of chars of current guess
var wordLength=0;
var secretWord;
var buttonPressNum=0;


function Wordle() {
  const [inGameState, setInGameState] = useState(0);
  const [settingMenu, setSettingMenu] = useState(0);
  const [settingMenuText, setSettingMenuText] = useState("");
  const [outputMessage, setOutputMessage] = useState("");

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
  }

  // fills the dictionary array with words on the intial load.
  useEffect(() => {
    fetchDictionary();
  }, []);


  const newGameButton = () => {
    setOutputMessage("");
    buttonPressNum++;
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

    setInGameState(inGameState+1);

    let wordSet=false;
    // let loopNum=0;
    // stop guessing random words when a word matches the settings.
    while(!wordSet){
      // loopNum++; console.log("#"+loopNum+" loop");
      secretWord = Dictionary[(((Math.random()*Dictionary.length+1)) | 0)]; // random word in list
      if((settingMenuText==="")||(parseFloat(settingMenuText)===secretWord.length)){    // if no desired wordlength or secretword length equals desired word length
        wordLength = secretWord.length;
        wordSet=true;
      }
      // console.log(parseFloat(settingMenuText));
      // console.log(secretWord.length);
      // console.log(secretWord);
    }
  }

  const revealSolutionButton = () => {
    buttonPressNum++;
    setInGameState(inGameState+1);
  }
  const toggleSettings = () => {
    setSettingMenu(settingMenu+1);
  }

  function GetGuessGrid(){
    let grid= [];
    for(let i = 0; i < 6; i++){     // number of guesses
      for(let j = 0; j < wordLength; j++){   // word length
        grid.push(<div id={i+'-'+j} className="key-guess" key={i+'-'+j}>Q</div>)
      }
      grid.push(<br/>)
    }
    return grid;
  }


  return (
    <div>
      <div className='wordle-space'>
        <div className="title">
          Wordle
        </div>
        <div className="guessGrid">
          <GetGuessGrid/>
          <br/>
          {(buttonPressNum%2===0)&&secretWord}
        </div>
        <ul className="keyboard">
          {Object.keys(keys).map((key,index) => (
            <>
            {(key.includes("break"))?<br/>:<button id={key} className='key' key={index} >{key}</button>}
            </>
          ))}
        </ul>
        <div className="automate">
          {(inGameState%2===0)?
            <button id="automate-newBut" onClick={newGameButton} >
            New Game
            </button>:
            <button id="automate-solutionBut" onClick={revealSolutionButton} >
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