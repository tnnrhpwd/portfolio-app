import React, { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'react-toastify';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import url from "./../WordleSolver/Dictionary.txt";
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom'              // page redirects
import { updateData, getData, resetDataSlice, deleteData } from '../../../features/data/dataSlice.js';
import "./Wordle.css";

const initialKeys = {
  'Q': '', 'W': '', 'E': '', 'R': '', 'T': '', 'Y': '', 'U': '', 'I': '', 'O': '', 'P': '', 'break': '',
  'A': '', 'S': '', 'D': '', 'F': '', 'G': '', 'H': '', 'J': '', 'K': '', 'L': '', 'break2': '',
  '⏎': '', 'Z': '', 'X': '', 'C': '', 'V': '', 'B': '', 'N': '', 'M': '', '⌫': ''
};

const maxGuesses = 6;
const Correct = 'correct'; 
const Found = 'found';
const Wrong = 'wrong';

function Wordle() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  
  // State management
  const [keys, setKeys] = useState(initialKeys);
  const [dictionary, setDictionary] = useState([]);
  const [guesses, setGuesses] = useState([]);
  const [currentGuess, setCurrentGuess] = useState([]);
  const [wordLength, setWordLength] = useState(0);
  const [buttonPressNum, setButtonPressNum] = useState(0);
  const [secretWord, setSecretWord] = useState("");
  const [definition, setDefinition] = useState("");
  const [inGameState, setInGameState] = useState(0);
  const [settingMenu, setSettingMenu] = useState(0);
  const [settingMenuText, setSettingMenuText] = useState("5");
  const [outputMessage, setOutputMessage] = useState("");
  const [answerVisibility, setAnswerVisibility] = useState(false);
  const [isDictionaryLoaded, setIsDictionaryLoaded] = useState(false);
  
  const keyListenerRef = useRef(null);
  const rootStyle = window.getComputedStyle(document.body);
  const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);

  const { user, data, dataIsError, dataMessage } = useSelector((state) => state.data);

  // Helper functions
  const updateKeyGuessCount = useCallback((numCharacters) => {
    numCharacters = parseInt(numCharacters);
    if (isNaN(numCharacters)) {
        console.error('Invalid number of characters');
        return;
    }
    document.documentElement.style.setProperty('--key-guess-count', `${numCharacters}`);
  }, []);

  const countLetters = useCallback((strng1, strng2) => {
    let appearances = 0;
    for(let xf = 0; xf < strng2.length; xf++){
      if (strng2.charAt(xf) === strng1){
        appearances++;
      }
    }
    return appearances;
  }, []);

  // Reset game state
  const resetInitialValues = useCallback(() => {
    setKeys(initialKeys);
    setGuesses([]);
    setCurrentGuess([]);
    setWordLength(0);
    setSecretWord("");
    setButtonPressNum(0);
    setAnswerVisibility(false);

    // Reset keyboard visual state
    Object.keys(initialKeys).forEach(key => {
      let keyElement = document.getElementById(key);
      if(keyElement != null){
        keyElement.className = '';
        keyElement.classList.add('key');
      }
    });
  }, []);

  // Dictionary loading
  const fetchDictionary = useCallback(async () => {
    try {
      const response = await fetch(url);
      const data = await response.text();
      let dictionaryArray = data.toUpperCase();
      dictionaryArray = dictionaryArray.split('\r\n');
      if(!(dictionaryArray[0] === "AA")){                    
        dictionaryArray = dictionaryArray[0].split("\n");
      }
      setDictionary(dictionaryArray);
      setIsDictionaryLoaded(true);
      console.log("Dictionary loaded successfully");
    } catch (err) {
      console.error("Error loading dictionary:", err);
      toast.error("Failed to load dictionary", { autoClose: toastDuration });
    }
  }, [toastDuration]);

  // API functions
  const getMyData = useCallback(async () => {
    try {
      console.log("Call the getData action to fetch your experience");
      await dispatch(getData({ data: "Word:" }));
    } catch (error) {
      console.error(error);
      toast.error(error, { autoClose: toastDuration });
    }
  }, [dispatch, toastDuration]);

  const fetchRandomWordFromBackend = useCallback(async (wordLength) => {
    try {
      console.log("Calling Word API...")
      await dispatch(getData({ data: `getword:${wordLength}` }));
    } catch (error) {
      console.error('Error Calling Word API:', error.message);
      throw error;
    }
  }, [dispatch]);

  const fetchDefinition = useCallback(async (word) => {
    try {
      console.log(`Fetching definition for ${word}...`);
      await dispatch(getData({ data: `getdef:${word}` }));
    } catch (error) {
      console.error('Error fetching definition:', error.message);
      throw error;
    }
  }, [dispatch]);

  // Game logic
  const endOfGame = useCallback(async () => {
    setAnswerVisibility(true);
    try {
      setOutputMessage(`The answer is ${secretWord}. Definition: ${definition}`);
    } catch (error) {
      console.error('Error fetching definition:', error.message);
      setOutputMessage(`The answer is ${secretWord}. Definition not available.`);
    }
  }, [secretWord, definition]);

  const publishKeyboard = useCallback(() => {
    Object.keys(keys).forEach(key => {
      if (keys[key] !== '') {
        let keyElement = document.getElementById(`${key}`);
        if (keyElement) {
          keyElement.className = '';
          keyElement.classList.add(keys[key]);
          keyElement.classList.add('key');
        }
      }
    });
  }, [keys]);

  const backspace = useCallback(() => {
    if(currentGuess.length === 0) return;
    setCurrentGuess(prev => prev.slice(0, -1));
  }, [currentGuess.length]);

  const enter = useCallback(() => {
    // GUARD CLAUSE - enough letters and lives
    if (currentGuess.length < wordLength || guesses.length >= maxGuesses) {
      return;
    }
    
    const guessString = currentGuess.map(keyGuess => keyGuess.key).join("");
    
    // GUARD CLAUSE - not a word
    if (!(dictionary.includes(guessString) || guessString.toLowerCase() === secretWord.toLowerCase())) {
      toast.info('That is not a word. Please try again.', { autoClose: toastDuration });
      return;
    }

    // Process the guess
    const processedGuess = currentGuess.map((keyGuess, index) => {
      const lowKeyGuess = keyGuess.key.toLowerCase();
      const lowSecretWord = secretWord.toLowerCase();
      
      if (lowSecretWord.charAt(index) === lowKeyGuess) {
        return { ...keyGuess, result: Correct };
      } else if (lowSecretWord.includes(lowKeyGuess)) {
        let CRTappearances = 0;
        for (let xf = 0; xf < guessString.length; xf++) {
          if (guessString.charAt(xf).toLowerCase() === lowKeyGuess && lowSecretWord.charAt(xf) === lowKeyGuess) {
            CRTappearances++;
          }
        }
        if (countLetters(lowKeyGuess, lowSecretWord) > CRTappearances && 
            countLetters(lowKeyGuess, lowSecretWord) > countLetters(lowKeyGuess, guessString.substring(0, index))) {
          return { ...keyGuess, result: Found };
        } else {
          return { ...keyGuess, result: Wrong };
        }
      } else {
        return { ...keyGuess, result: Wrong };
      }
    });

    // Update keys state
    setKeys(prevKeys => {
      const newKeys = { ...prevKeys };
      processedGuess.forEach(keyGuess => {
        if ((newKeys[keyGuess.key] === Wrong) || (newKeys[keyGuess.key] === "")) {
          newKeys[keyGuess.key] = keyGuess.result;
        }
        if ((newKeys[keyGuess.key] === Found) && (keyGuess.result === Correct)) {
          newKeys[keyGuess.key] = keyGuess.result;
        }
      });
      return newKeys;
    });

    // Check win/lose conditions
    if((guessString.toLowerCase() === secretWord.toLowerCase()) || (guesses.length > (maxGuesses-2))){ 
      setOutputMessage("Thanks for playing!");
      endOfGame();
    }
    
    // Update game state
    setGuesses(prev => [...prev, processedGuess]);
    setCurrentGuess([]);
  }, [currentGuess, wordLength, guesses.length, dictionary, secretWord, toastDuration, countLetters, endOfGame]);

  const keyPress = useCallback((key) => {
    switch(key){
      case '⌫': 
        backspace(); 
        break; 
      case '⏎': 
        enter();
        break;
      default:
        if (currentGuess.length < wordLength && guesses.length < maxGuesses) {
          setCurrentGuess(prev => [...prev, { key: key, result: '' }]);
        }
    }
  }, [currentGuess.length, wordLength, guesses.length, backspace, enter]);

  // Event listeners
  const keyListener = useCallback((event) => {
    if(event.code === undefined) return;
    
    if(event.code.length === 4){
      keyPress(event.code.substring(3,4));
    }
    switch(event.code){
      case 'Backspace': 
        keyPress('⌫'); 
        break;
      case 'Enter': 
        keyPress('⏎'); 
        break;
      default:
        break;
    }
  }, [keyPress]);

  const startKeyListen = useCallback(() => {
    const handleKeydown = keyListener;
    document.addEventListener('keydown', handleKeydown, false);
    keyListenerRef.current = handleKeydown;
    console.log("Now listening for keyboard inputs");
    return () => document.removeEventListener('keydown', handleKeydown, false);
  }, [keyListener]);

  // UI functions
  const loginWelcome = useCallback(() => {
    if (user) {
      toast.success(`Welcome back, ${user.nickname}!`, { autoClose: toastDuration });
    } else {
      toast.info('Welcome! Please login to play. This page uses an api with tracked usage.', { autoClose: 4000 });
    }
  }, [user, toastDuration]);

  const newGameButton = useCallback(async () => {
    // GUARD CLAUSE - only numbers OR empty
    if (!(/^\d+$/.test(settingMenuText))) {
      if (!(settingMenuText === "")){
        setOutputMessage("Please enter a number in the text field.");
        return;
      }
    }
    // GUARD CLAUSE - wordlength over 15 letters
    if (parseFloat(settingMenuText) > 15){
      setOutputMessage("Please reduce the wordlength.");
      return;
    }
    // GUARD CLAUSE - wordlength under 3 letters
    if (parseFloat(settingMenuText) < 3){
      setOutputMessage("Please increase the wordlength.");
      return;
    }

    resetInitialValues();
    setOutputMessage("");
    setButtonPressNum(prev => prev + 1);
    setInGameState(1);

    try {
      const newWordLength = parseFloat(settingMenuText);
      setWordLength(newWordLength);
      await fetchRandomWordFromBackend(newWordLength);
    } catch (error) {
      console.error('Error fetching random word:', error.message);
      setOutputMessage('Error fetching random word. Please try again later.');
    }
  }, [settingMenuText, resetInitialValues, fetchRandomWordFromBackend]);

  const toggleSettings = useCallback(() => {
    setSettingMenu(prev => prev + 1);
  }, []);

  const GetGuessGrid = useCallback(() => {
    let grid = [];
    for(let i = 0; i < maxGuesses; i++){
      for(let j = 0; j < wordLength; j++){
        let lett = "";
        let lettClass = "key-guess";
        if(guesses[i]){
          lett = guesses[i][j].key;
          lettClass = "key-guess "+guesses[i][j].result;
        }
        grid.push(<div id={i+'-'+j} className={lettClass} key={i+'-'+j}>{lett}</div>)
      }
      grid.push(<br key={i}/>)
    }
    updateKeyGuessCount(wordLength);
    return grid;
  }, [wordLength, guesses, updateKeyGuessCount]);

  // Effects
  useEffect(() => {
    const launchTimer = setTimeout(async () => {
      await fetchDictionary();
      const cleanup = startKeyListen();
      getMyData();
      loginWelcome();
      
      return cleanup;
    }, 50);
  
    return () => {
      clearTimeout(launchTimer);
      if (keyListenerRef.current) {
        document.removeEventListener('keydown', keyListenerRef.current, false);
      }
    };
  }, [fetchDictionary, startKeyListen, getMyData, loginWelcome]);

  useEffect(() => {
    if (dataMessage && !dataMessage.includes('token')) {
      if(dataMessage.includes('getdef'))
        toast.error("We're sorry. Connection to the definition API has failed", { autoClose: toastDuration });
    }
  }, [dataIsError, dataMessage, toastDuration]);

  useEffect(() => {
    console.log("State data has been updated:", data);
    
    if(data && data.word){
      const secretTimer = setTimeout(() => {
        console.log("XXXXXXXXX Secret Word updated.");
        setSecretWord(data.word);
        fetchDefinition(data.word);
      }, 50);
      return () => clearTimeout(secretTimer);
    }
    
    if(data && data.worddef){
      const defTimer = setTimeout(() => {
        console.log("XXXXXXXXX Definition updated.");
        setDefinition(data.worddef);
      }, 50);
      return () => clearTimeout(defTimer);
    }
  }, [data, fetchDefinition]);

  // Use effect to update grid when current guess changes
  useEffect(() => {
    let row = guesses.length;
    for (let i = 0; i < wordLength; i++){
      let keyID = document.getElementById(row+"-"+i);
      if (keyID) {
        if (currentGuess[i]) {
          keyID.innerHTML = currentGuess[i].key;
        } else {
          keyID.innerHTML = '';
        }
      }
    }
  }, [currentGuess, wordLength, guesses.length]);

  // Use effect to update keyboard when keys change
  useEffect(() => {
    publishKeyboard();
  }, [keys, publishKeyboard]);

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

export default Wordle;
