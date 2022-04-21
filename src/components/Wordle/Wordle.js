import React, { useEffect, useState } from 'react';
import Footer from './../Footer/Footer';
import url from "./../WordleSolver/Dictionary.txt";
import "./Wordle.css";

let keys = { //create dictionary object to store pairs of keys and result(correct, found, wrong).
  'Q': '', 'W': '', 'E': '', 'R': '', 'T': '', 'Y': '', 'U': '', 'I': '', 'O': '', 'P': '', 'break': '',
  'A': '', 'S': '', 'D': '', 'F': '', 'G': '', 'H': '', 'J': '', 'K': '', 'L': '', 'break2': '',
  'enter': '', 'Z': '', 'X': '', 'C': '', 'V': '', 'B': '', 'N': '', 'M': '', '⌫': ''
};

var Dictionary=[];
var guesses = []; // array full of user previous guesses
var currentGuess = []; // array full of chars of current guess
var wordLength=0;
var secretWord;
var buttonPressNum=0;


function Wordle() {
  const [inGameState, setInGameState] = useState(0);

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
  // useEffect(() => {
  //   if(!(buttonPressNum===0)){
  //     secretWord = Dictionary[(((Math.random()*Dictionary.length+1)) | 0)]; // random word in list
  //     wordLength = secretWord.length;
  //     console.log(secretWord);
  //     console.log(wordLength);
  //   }
  // }, [inGameState]);


  const newGameButton = () => {
    buttonPressNum++;
    setInGameState(inGameState+1);
    secretWord = Dictionary[(((Math.random()*Dictionary.length+1)) | 0)]; // random word in list
    wordLength = secretWord.length;
    console.log(secretWord);
  }

  const revealSolutionButton = () => {
    buttonPressNum++;
    setInGameState(inGameState+1);
  }
  const toggleSettings = () => {

  }

  return (
    <div>
      <div className='wordle-space'>
        <div className="title">
          Wordle
        </div>
        <div className="guessGrid">

        </div>
        <div className="keyboard">
        {secretWord}
        </div>
        <div className="automate">
          {(inGameState%2===0)?
            <button onClick={newGameButton} >
            New Game
            </button>:
            <button onClick={revealSolutionButton} >
            Reveal Solution
            </button>
            }
            <button onClick={toggleSettings}>
            ⚙
            </button>
        </div>
        <div className="credits">

        </div>
      </div>
      <Footer/>
    </div>
    
  );
}

export default Wordle