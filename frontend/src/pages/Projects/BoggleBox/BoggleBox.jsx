import React, { useEffect }  from 'react';
// import { useState } from 'react';
import NavBar from '../../../components/NavBar/NavBar';
import Footer from '../../../components/Footer/Footer';
import DictionaryURL from "../WordleSolver/Dictionary.txt";

import './BoggleBox.css';


function BoggleBox() {
  // const [activeGame, setActiveGame] = useState(false)

  const die0 = ["R","I","F","O","B","X"]
  const die1 = ["I","F","E","H","E","Y"]
  const die2 = ["D","E","N","O","W","S"]
  const die3 = ["U","T","O","K","N","D"]
  const die4 = ["H","M","S","R","A","O"]
  const die5 = ["L","U","P","E","T","S"]
  const die6 = ["A","C","I","T","O","A"]
  const die7 = ["Y","L","G","K","U","E"]
  const die8 = ["QU","B","M","J","O","A"]
  const die9 = ["E","H","I","S","P","N"]
  const die10 = ["V","E","T","I","G","N"]
  const die11 = ["B","A","L","I","Y","T"]
  const die12 = ["E","Z","A","V","N","D"]
  const die13 = ["R","A","L","E","S","C"]
  const die14 = ["U","W","I","L","R","G"]
  const die15 = ["P","A","C","E","M","D"]
  var dieConfig = [die0,die1,die2,die3,die4,die5,die6,die7,die8,die9,die10,die11,die12,die13,die14,die15]
  var dictionary = []


  // fills the dictionary with words
  function fetchDictionary() {
    fetch(DictionaryURL)
    .then(response => response.text())
    .then(data => {
      dictionary=data.toUpperCase();
      dictionary=dictionary.split('\r\n');            // this works local but not in-build
      if(!(dictionary[0]==="AA")){                    
        dictionary=dictionary[0].split("\n");       // backup splitter for in-build
      }
      console.log(dictionary)
    })
    .catch(err => console.log(err));
  }

  // randomly rearranges an array
  function shuffleArray(array) {
    let currentIndex = array.length,  randomIndex;
    // While there remain elements to shuffle.
    while (currentIndex !== 0) {
      // Pick a remaining element.
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex--;
      // And swap it with the current element.
      [array[currentIndex], array[randomIndex]] = [
        array[randomIndex], array[currentIndex]];
    }
    return array;
  }

  // Shuffles the dice. Then, pushes a random letter from each die to an output array
  function handleBoggleShuffle(){
    let shuffledDice = shuffleArray(dieConfig);
    var resultArray = [];
    shuffledDice.forEach(element => {
      let randomIndex = Math.floor(Math.random() * 6);
      resultArray.push(element[randomIndex])
    });
    return resultArray;
  }

  // builds a dictionary array (RUNS ON INTIAL LOAD)
  useEffect(() => {
    fetchDictionary()
  }, [])
  
  const shuffledLetters = handleBoggleShuffle()

  return (
    <div className="bogglebox">
      <NavBar/>
      <div className="bogglebox-spc">
      Boggle
        <div className='bogglebox-spc-board'>
          <div className='bogglebox-spc-board-ltrs'>
            <div className='bogglebox-spc-board-ltrs-1'>
              <div className='bogglebox-spc-board-ltrs-letter'>{shuffledLetters[0]}</div>
              <div className='bogglebox-spc-board-ltrs-letter'>{shuffledLetters[1]}</div>
              <div className='bogglebox-spc-board-ltrs-letter'>{shuffledLetters[2]}</div>
              <div className='bogglebox-spc-board-ltrs-letter'>{shuffledLetters[3]}</div>
            </div> 
            <div className='bogglebox-spc-board-ltrs-2'>
              <div className='bogglebox-spc-board-ltrs-letter'>{shuffledLetters[4]}</div>
              <div className='bogglebox-spc-board-ltrs-letter'>{shuffledLetters[5]}</div>
              <div className='bogglebox-spc-board-ltrs-letter'>{shuffledLetters[6]}</div>
              <div className='bogglebox-spc-board-ltrs-letter'>{shuffledLetters[7]}</div>
            </div> 
            <div className='bogglebox-spc-board-ltrs-3'>
              <div className='bogglebox-spc-board-ltrs-letter'>{shuffledLetters[8]}</div>
              <div className='bogglebox-spc-board-ltrs-letter'>{shuffledLetters[9]}</div>
              <div className='bogglebox-spc-board-ltrs-letter'>{shuffledLetters[10]}</div>
              <div className='bogglebox-spc-board-ltrs-letter'>{shuffledLetters[11]}</div>
            </div> 
            <div className='bogglebox-spc-board-ltrs-4'>
              <div className='bogglebox-spc-board-ltrs-letter'>{shuffledLetters[12]}</div>
              <div className='bogglebox-spc-board-ltrs-letter'>{shuffledLetters[13]}</div>
              <div className='bogglebox-spc-board-ltrs-letter'>{shuffledLetters[14]}</div>
              <div className='bogglebox-spc-board-ltrs-letter'>{shuffledLetters[15]}</div>
            </div> 
          </div> 
        </div>        
        <div className='bogglebox-spc-timer'>
          
        </div>        
        <div className='bogglebox-spc-menu'>

        </div>
        <div className='bogglebox-spc-input'>
          <input/>
        </div>
        <div className='bogglebox-spc-answer'>
          
        </div>

      </div>
      <Footer/>
    </div>
  )
}

export default BoggleBox