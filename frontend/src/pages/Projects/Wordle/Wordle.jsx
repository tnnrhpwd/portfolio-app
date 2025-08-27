import React, { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'react-toastify';
import Header from '../../../components/Header/Header';
import Footer from '../../../components/Footer/Footer';
import url from "./../WordleSolver/Dictionary.txt";
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom'              // page redirects
import { getData } from '../../../features/data/dataSlice.js';
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

// Simple common words for easier gameplay
const simpleWords = [
  // 3-letter words
  'CAT', 'DOG', 'BAT', 'HAT', 'RAT', 'CAR', 'BAR', 'JAR', 'TAR', 'WAR',
  'SUN', 'RUN', 'FUN', 'GUN', 'BUN', 'NUN', 'PUN', 'CUP', 'PUP', 'SUP',
  'BED', 'RED', 'LED', 'WED', 'FED', 'PEN', 'TEN', 'HEN', 'DEN', 'MEN',
  'BOX', 'FOX', 'SIX', 'MIX', 'FIX', 'BAG', 'TAG', 'RAG', 'LAG', 'WAG',
  'BIG', 'DIG', 'FIG', 'JIG', 'PIG', 'RIG', 'WIG', 'ZIP', 'TIP', 'HIP',
  'BOOK', 'LOOK', 'TOOK', 'COOK', 'HOOK', 'DOOR', 'POOR', 'ROOF', 'FOOD', 'GOOD',
  'MOON', 'SOON', 'ROOM', 'BOOM', 'ZOOM', 'COOL', 'POOL', 'TOOL', 'WOOL', 'FOOL',
  'TREE', 'FREE', 'KNEE', 'FLEE', 'SEED', 'NEED', 'FEED', 'WEED', 'DEED', 'REED',
  'BIRD', 'WORD', 'WORK', 'WALK', 'TALK', 'PARK', 'DARK', 'MARK', 'BARK', 'LARK',
  'FISH', 'DISH', 'WISH', 'RICH', 'SUCH', 'MUCH', 'RUSH', 'BUSH', 'PUSH', 'CASH',
  'HAND', 'LAND', 'SAND', 'BAND', 'WAND', 'WIND', 'KIND', 'MIND', 'FIND', 'BIND',
  'HOME', 'COME', 'SOME', 'DOME', 'BONE', 'CONE', 'TONE', 'ZONE', 'LONE', 'GONE',
  'FIRE', 'WIRE', 'TIRE', 'HIRE', 'DIRE', 'CARE', 'DARE', 'FARE', 'HARE', 'RARE',
  'TIME', 'LIME', 'DIME', 'MIME', 'NAME', 'CAME', 'FAME', 'GAME', 'SAME', 'TAME',
  'LOVE', 'DOVE', 'MOVE', 'COVE', 'LIVE', 'GIVE', 'FIVE', 'HIVE', 'DIVE', 'WAVE',
  'HAPPY', 'PARTY', 'SUNNY', 'FUNNY', 'MONEY', 'HONEY', 'HORSE', 'HOUSE', 'MOUSE', 'LOOSE',
  'FIRST', 'WORST', 'BURST', 'TRUST', 'FROST', 'GHOST', 'COAST', 'TOAST', 'ROAST', 'BOAST',
  'BREAK', 'SPEAK', 'SNEAK', 'FREAK', 'DREAM', 'CREAM', 'STEAM', 'GLEAM', 'OCEAN', 'CLEAN',
  'HEART', 'START', 'SMART', 'APART', 'PARTY', 'THIRTY', 'DIRTY', 'EMPTY', 'FIFTY', 'SIXTY',
  'LIGHT', 'FIGHT', 'NIGHT', 'RIGHT', 'SIGHT', 'MIGHT', 'TIGHT', 'FRUIT', 'PAINT', 'POINT',
  'WATER', 'AFTER', 'UNDER', 'OTHER', 'POWER', 'TOWER', 'LOWER', 'FLOWER', 'PAPER', 'SUPER',
  'GREEN', 'QUEEN', 'SEVEN', 'EIGHT', 'THREE', 'WHERE', 'THERE', 'THESE', 'THOSE', 'PLACE',
  'SPACE', 'GRACE', 'TRACE', 'PEACE', 'PIECE', 'VOICE', 'CHOICE', 'NOISE', 'HOUSE', 'COURSE',
  'WORLD', 'FIELD', 'BUILD', 'CHILD', 'YOUNG', 'SOUND', 'FOUND', 'ROUND', 'POUND', 'GROUND',
  'SMALL', 'LARGE', 'CHANGE', 'RANGE', 'STAGE', 'IMAGE', 'TABLE', 'APPLE', 'SMILE', 'WHILE',
  'FRIEND', 'GARDEN', 'BASKET', 'CAMERA', 'BUTTER', 'LETTER', 'BETTER', 'SISTER', 'WINTER',
  'SPRING', 'SUMMER', 'FATHER', 'MOTHER', 'BROTHER', 'COFFEE', 'OFFICE', 'SIMPLE', 'PEOPLE',
  'ANIMAL', 'SCHOOL', 'CHURCH', 'CORNER', 'BORDER', 'WONDER', 'FINGER', 'SINGLE', 'LITTLE',
  'MIDDLE', 'BOTTLE', 'BATTLE', 'RATTLE', 'CASTLE', 'GENTLE', 'PURPLE', 'ORANGE', 'YELLOW',
  'BRIGHT', 'FLIGHT', 'WEIGHT', 'HEIGHT', 'FOURTH', 'SMOOTH', 'STRONG', 'CHANGE', 'CHARGE',
  'CHOOSE', 'PLEASE', 'FROZEN', 'BROKEN', 'SPOKEN', 'GOLDEN', 'SILVER', 'DINNER', 'WINNER',
  'CHICKEN', 'KITCHEN', 'MORNING', 'EVENING', 'NOTHING', 'ANOTHER', 'WEATHER', 'PICTURE',
  'MACHINE', 'SPECIAL', 'GENERAL', 'PERFECT', 'PRESENT', 'PROBLEM', 'HUSBAND', 'OUTSIDE',
  'BEDROOM', 'FREEDOM', 'WELCOME', 'BETWEEN', 'WITHOUT', 'WORKING', 'READING', 'WRITING',
  'WALKING', 'LOOKING', 'TALKING', 'COMPANY', 'COUNTRY', 'HOLIDAY', 'STUDENT', 'TEACHER',
  'COMPUTER', 'REMEMBER', 'TOGETHER', 'MAGAZINE', 'BIRTHDAY', 'SANDWICH', 'SHOULDER',
  'CHILDREN', 'BUSINESS', 'QUESTION', 'FOOTBALL', 'BASEBALL', 'SWIMMING', 'SHOPPING',
  'ELEPHANT', 'PRINCESS', 'AIRPLANE', 'MOUNTAIN', 'BUILDING', 'SANDWICH', 'BREAKFAST',
  'BEAUTIFUL', 'DIFFERENT', 'SOMETHING', 'EVERYBODY', 'EDUCATION', 'CHRISTMAS', 'IMPORTANT',
  'WONDERFUL', 'FANTASTIC', 'PRESIDENT', 'TELEPHONE', 'DANGEROUS', 'POLLUTION', 'ADVENTURE',
  'BASKETBALL', 'GIRLFRIEND', 'RESTAURANT', 'PLAYGROUND', 'STRAWBERRY', 'GRANDMOTHER',
  'GRANDFATHER', 'MOTORCYCLE', 'SKATEBOARD', 'WATERMELON', 'COMFORTABLE', 'INTERESTING',
  'ENVIRONMENT', 'TEMPERATURE', 'CELEBRATION', 'CONVERSATION'
];

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
  const [answerWord, setAnswerWord] = useState("");
  const [answerVisibility, setAnswerVisibility] = useState(false);
  const [isCreditsExpanded, setIsCreditsExpanded] = useState(false);
  const [useFullDictionary, setUseFullDictionary] = useState(false);
  const [gameStartTime, setGameStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [gameActive, setGameActive] = useState(false);
  
  const keyListenerRef = useRef(null);
  const isDictionaryLoadedRef = useRef(false);
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

  const formatTime = useCallback((timeInSeconds) => {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = timeInSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, []);

  const startTimer = useCallback(() => {
    const startTime = Date.now();
    setGameStartTime(startTime);
    setGameActive(true);
    setElapsedTime(0);
  }, []);

  const stopTimer = useCallback(() => {
    setGameActive(false);
  }, []);

  const resetTimer = useCallback(() => {
    setGameStartTime(null);
    setElapsedTime(0);
    setGameActive(false);
  }, []);

  const getActiveDictionary = useCallback(() => {
    return useFullDictionary ? dictionary : simpleWords;
  }, [useFullDictionary, dictionary]);

  const getRandomWordFromDictionary = useCallback((wordLength) => {
    const activeDictionary = getActiveDictionary();
    const wordsOfLength = activeDictionary.filter(word => word.length === wordLength);
    
    if (wordsOfLength.length === 0) {
      console.warn(`No words of length ${wordLength} found in dictionary`);
      return null;
    }
    
    const randomIndex = Math.floor(Math.random() * wordsOfLength.length);
    return wordsOfLength[randomIndex];
  }, [getActiveDictionary]);

  const countLetters = useCallback((strng1, strng2) => {
    let appearances = 0;
    for(let xf = 0; xf < strng2.length; xf++){
      if (strng2.charAt(xf) === strng1){
        appearances++;
      }
    }
    return appearances;
  }, []);

  // Text truncation helpers
  const truncateText = useCallback((text, maxLength = 200) => {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  }, []);

  const TruncatedText = useCallback(({ 
    text, 
    maxLength = 200, 
    isExpanded, 
    setIsExpanded, 
    className = '',
    onClick = undefined
  }) => {
    const shouldTruncate = text && text.length > maxLength;
    const displayText = isExpanded ? text : truncateText(text, maxLength);
    
    return (
      <div className={className} onClick={onClick} style={onClick ? { cursor: 'pointer' } : {}}>
        {displayText}
        {shouldTruncate && (
          <button 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation(); // Prevent triggering the div's onClick
              setIsExpanded(!isExpanded);
            }}
            className="expand-toggle"
            style={{
              marginLeft: '8px',
              background: 'none',
              border: 'none',
              color: 'var(--fg-blue)',
              cursor: 'pointer',
              textDecoration: 'underline',
              fontSize: 'inherit',
              fontWeight: 'bold'
            }}
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    );
  }, [truncateText]);

  // Reset game state
  const resetInitialValues = useCallback(() => {
    setKeys(initialKeys);
    setGuesses([]);
    setCurrentGuess([]);
    // Don't reset wordLength here - it should be set by newGameButton
    setSecretWord("");
    setAnswerWord("");
    setButtonPressNum(0);
    setAnswerVisibility(false);
    setIsCreditsExpanded(false);
    resetTimer();
    // Note: Don't reset isDictionaryLoaded or isKeyboardListening as they should persist

    // Reset keyboard visual state
    Object.keys(initialKeys).forEach(key => {
      let keyElement = document.getElementById(key);
      if(keyElement != null){
        keyElement.className = '';
        keyElement.classList.add('key');
      }
    });
  }, [resetTimer]);

  // Dictionary loading
  const fetchDictionary = useCallback(async () => {
    if (isDictionaryLoadedRef.current) {
      return; // Already loaded, don't reload
    }
    
    try {
      const response = await fetch(url);
      const data = await response.text();
      let dictionaryArray = data.toUpperCase();
      dictionaryArray = dictionaryArray.split('\r\n');
      if(!(dictionaryArray[0] === "AA")){                    
        dictionaryArray = dictionaryArray[0].split("\n");
      }
      setDictionary(dictionaryArray);
      isDictionaryLoadedRef.current = true;
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
    stopTimer(); // Stop the timer when game ends
    setAnswerVisibility(true);
    setAnswerWord(secretWord); // Set just the word for wordle-answer
    
    try {
      const timeString = formatTime(elapsedTime);
      
      if (!user) {
        // User not logged in - show login prompt instead of definition
        setOutputMessage(`Time: ${timeString}\n\nWant to see definitions? Click here to login and unlock word definitions!`);
      } else if (definition) {
        // User logged in and definition available
        setOutputMessage(`Time: ${timeString}\n\nDefinition (from Urban Dictionary): ${definition}\n\n⚠️ Note: Definitions are sourced from Urban Dictionary and may contain inappropriate, offensive, or non-professional content. We are not responsible for the content of these definitions.`);
      } else {
        // User logged in but no definition available
        setOutputMessage(`Time: ${timeString}\n\nThanks for playing! Definition not available.`);
      }
    } catch (error) {
      console.error('Error setting definition:', error.message);
      const timeString = formatTime(elapsedTime);
      setOutputMessage(`Time: ${timeString}\n\nThanks for playing! Definition not available.`);
    }
  }, [secretWord, definition, stopTimer, formatTime, elapsedTime, user]);

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
    
    // GUARD CLAUSE - not a word (check both simple words AND full dictionary for all guesses)
    const isValidWord = simpleWords.includes(guessString) || 
                       dictionary.includes(guessString) || 
                       guessString.toLowerCase() === secretWord.toLowerCase();
    
    if (!isValidWord) {
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
  }, [currentGuess, wordLength, guesses.length, secretWord, toastDuration, countLetters, endOfGame, dictionary]);

  const keyPress = useCallback((key, fromVirtualKeyboard = false) => {
    console.log('keyPress called with:', key, 'currentGuess length:', currentGuess.length, 'wordLength:', wordLength, 'guesses length:', guesses.length, 'inGameState:', inGameState, 'answerVisibility:', answerVisibility);
    
    switch(key){
      case '⌫': 
        console.log('Calling backspace');
        backspace(); 
        break; 
      case '⏎': 
        console.log('Calling enter');
        enter();
        break;
      default:
        if (currentGuess.length < wordLength && guesses.length < maxGuesses) {
          console.log('Adding letter to current guess:', key);
          setCurrentGuess(prev => {
            const newGuess = [...prev, { key: key, result: '' }];
            console.log('New current guess:', newGuess);
            return newGuess;
          });
        } else {
          console.log('Cannot add letter - currentGuess.length:', currentGuess.length, 'wordLength:', wordLength, 'guesses.length:', guesses.length, 'maxGuesses:', maxGuesses);
        }
    }
    
    // If this was a virtual keyboard press, remove focus to allow physical keyboard input
    if (fromVirtualKeyboard) {
      setTimeout(() => {
        if (document.activeElement && document.activeElement.blur) {
          document.activeElement.blur();
        }
      }, 10);
    }
  }, [currentGuess.length, wordLength, guesses.length, backspace, enter, inGameState, answerVisibility]);

  // Event listeners - SIMPLE APPROACH: just capture all keys during active gameplay
  const keyListener = useCallback((event) => {
    console.log('Keyboard event:', event.key, 'Game state:', inGameState, 'Answer visible:', answerVisibility);
    
    // Only process keyboard events during active gameplay
    // Game is active when inGameState is odd AND answer is not visible
    if (inGameState % 2 !== 1 || answerVisibility === true) {
      console.log('Game not active, ignoring keyboard input');
      return; // Game not active, ignore keyboard input
    }

    // Don't prevent default for input fields or other elements that need keyboard input
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      console.log('Input field focused, ignoring keyboard input');
      return;
    }

    // Prevent default behavior for game keys
    event.preventDefault();
    
    console.log('Processing keyboard input:', event.key);

    const key = event.key.toUpperCase();
    
    // Handle letter keys (A-Z)
    if (key.length === 1 && key >= 'A' && key <= 'Z') {
      console.log('Letter key pressed:', key);
      keyPress(key);
      return;
    }
    
    // Handle special keys
    switch(event.code || event.key) {
      case 'Backspace':
      case 'Delete':
        console.log('Backspace key pressed');
        keyPress('⌫'); 
        break;
      case 'Enter':
      case 'NumpadEnter':
        console.log('Enter key pressed');
        keyPress('⏎'); 
        break;
      default:
        console.log('Other key pressed, ignoring:', event.key);
        break;
    }
  }, [keyPress, inGameState, answerVisibility]);

  const startKeyListen = useCallback(() => {
    // Remove any existing listener first
    if (keyListenerRef.current) {
      document.removeEventListener('keydown', keyListenerRef.current, false);
    }
    
    const handleKeydown = keyListener;
    // Simple document-level listener
    document.addEventListener('keydown', handleKeydown, false);
    keyListenerRef.current = handleKeydown;
    console.log("Now listening for keyboard inputs");
    
    return () => {
      document.removeEventListener('keydown', handleKeydown, false);
      keyListenerRef.current = null;
    };
  }, [keyListener]);

  // UI functions
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

    const newWordLength = parseFloat(settingMenuText);
    console.log('Setting new word length to:', newWordLength);
    
    resetInitialValues();
    setOutputMessage("");
    setButtonPressNum(prev => prev + 1);
    setInGameState(1);
    setWordLength(newWordLength); // Set word length after reset

    try {
      if (useFullDictionary && user) {
        // Use backend API for full dictionary (only if user is logged in)
        await fetchRandomWordFromBackend(newWordLength);
        // Timer will start when word is received in useEffect
      } else if (useFullDictionary && !user) {
        // User wants full dictionary but isn't logged in - fall back to simple words
        const randomWord = getRandomWordFromDictionary(newWordLength);
        if (randomWord) {
          setSecretWord(randomWord);
          startTimer();
          // Don't fetch definition for non-logged-in users
        } else {
          setOutputMessage(`No ${newWordLength}-letter words available. Please try a different length.`);
        }
      } else {
        // Use local simple dictionary
        const randomWord = getRandomWordFromDictionary(newWordLength);
        if (randomWord) {
          setSecretWord(randomWord);
          startTimer(); // Start timer immediately for simple words
          // Only fetch definition if user is logged in
          if (user) {
            try {
              await fetchDefinition(randomWord);
            } catch (error) {
              console.log('Could not fetch definition for simple word, continuing without it');
              setDefinition("");
            }
          }
        } else {
          setOutputMessage(`No simple words available for length ${newWordLength}. Try using Full Dictionary mode.`);
        }
      }
    } catch (error) {
      console.error('Error setting up new game:', error.message);
      setOutputMessage('Error setting up new game. Please try again.');
    }
  }, [settingMenuText, resetInitialValues, fetchRandomWordFromBackend, useFullDictionary, getRandomWordFromDictionary, fetchDefinition, startTimer, user]);

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

  // Effects - Initialize dictionary and setup keyboard listener
  useEffect(() => {
    let cleanup;
    
    const launchTimer = setTimeout(async () => {
      if (!isDictionaryLoadedRef.current) {
        await fetchDictionary();
      }
    }, 50);
  
    return () => {
      clearTimeout(launchTimer);
      if (cleanup) {
        cleanup();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally empty - we want this to run only once on mount

  // Separate effect for keyboard listener that updates when dependencies change
  useEffect(() => {
    const cleanup = startKeyListen();
    return cleanup;
  }, [startKeyListen]);

  // Separate effect for getMyData - only runs once  
  useEffect(() => {
    getMyData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally empty - we want this to run only once on mount

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
        startTimer(); // Start timer when word is received from backend
        // Only fetch definition if user is logged in
        if (user) {
          fetchDefinition(data.word);
        }
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
  }, [data, fetchDefinition, startTimer, user]);

  // Timer update effect
  useEffect(() => {
    let intervalId;
    
    if (gameActive && gameStartTime) {
      intervalId = setInterval(() => {
        const currentTime = Date.now();
        const elapsed = Math.floor((currentTime - gameStartTime) / 1000);
        setElapsedTime(elapsed);
      }, 1000);
    }
    
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [gameActive, gameStartTime]);

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
    <div 
      className='wordle-space' 
      id='wordle-space'
      data-in-game-state={inGameState}
      data-answer-visibility={answerVisibility.toString()}
    >
      <Header/>
      <div className="title">
        Wordle
      </div>
      {gameActive && (
        <div className="timer">
          Time: {formatTime(elapsedTime)}
        </div>
      )}
      <div className="guessGrid">
        <GetGuessGrid/>
        <div/>
        {(buttonPressNum===0)&&<div className="game-start-message">Press New Game to begin!</div>}
      </div>
      {(answerVisibility===true)&&
        <div className='wordle-answer'>
          The answer is: <strong>{answerWord.toUpperCase()}</strong>
        </div>
      }  
      <div className="keyboard">
        {(inGameState%2===1)&&
          <div className="keyboard-div1" key="keyboard-div1">
            {Object.keys(keys).map((key,index) => (
              <div className='keyboard-div2' key={"keyboard-div2"+key}>
                {(key.includes("break"))?<br key={index} />:
                  <button 
                    id={key} 
                    onClick={() => keyPress(key, true)} 
                    className='key' 
                    key={key}
                    onMouseDown={(e) => e.preventDefault()} // Prevent focus on mouse down
                  >
                    {key}
                  </button>
                }
              </div>
            ))}
          </div>
        }
      </div>
      <div className="automate">
      {(inGameState % 2 === 0 || answerVisibility) ? (
        <button id="automate-newBut" onClick={newGameButton}>
          New Game
        </button>
      ) : (
        <button id="automate-solutionBut" onClick={endOfGame}>
          Reveal Solution
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
            <br/>
            <label style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: 'calc(var(--nav-size)*.25)', fontWeight: 'bold'}}>
              <input 
                type="checkbox" 
                checked={useFullDictionary} 
                onChange={e => setUseFullDictionary(e.target.checked)}
                style={{transform: 'scale(1.2)'}}
              />
              Use Full Dictionary (Advanced Words)
            </label>
            <div style={{fontSize: 'calc(var(--nav-size)*.18)', marginTop: '8px', fontStyle: 'italic', opacity: '0.8'}}>
              {useFullDictionary ? 'Uses API with difficult/uncommon words' : 'Uses simple common words'}
            </div>
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
      <TruncatedText 
        text={outputMessage}
        maxLength={150}
        isExpanded={isCreditsExpanded}
        setIsExpanded={setIsCreditsExpanded}
        className={`credits ${!user && outputMessage.includes('login') ? 'credits-clickable' : ''}`}
        onClick={!user && outputMessage.includes('login') ? () => navigate('/login') : undefined}
      />
      <Footer/>
    </div>
  );
}

export default Wordle;
