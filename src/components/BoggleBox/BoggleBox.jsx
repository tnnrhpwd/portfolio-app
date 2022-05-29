import { useState } from 'react';
import NavBar from '../NavBar/NavBar';
import Footer from '../Footer/Footer';
import Dictionary from "./../WordleSolver/Dictionary.txt";

import './BoggleBox.css';


function BoggleBox() {
  const [activeGame, setActiveGame] = useState(false)

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



  function shuffleArray(array) {
    let currentIndex = array.length,  randomIndex;
  
    // While there remain elements to shuffle.
    while (currentIndex != 0) {
  
      // Pick a remaining element.
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex--;
  
      // And swap it with the current element.
      [array[currentIndex], array[randomIndex]] = [
        array[randomIndex], array[currentIndex]];
    }
  
    return array;
  }

  function handleBoggleShuffle(){
    let shuffledDice = shuffleArray(dieConfig);
    var resultArray = [];
    shuffledDice.forEach(element => {
      let randomIndex = Math.floor(Math.random() * 6);
      resultArray.push(element[randomIndex])
    });

    return resultArray;
  }

  const shuffledLetters = handleBoggleShuffle()

  return (
    <div className="bogglebox">
      <NavBar/>
      <div className="bogglebox-spc">
        <div className='bogglebox-spc-board'>
          <div className='bogglebox-spc-board-ltrs'>
            <div className='bogglebox-spc-board-ltrs-1'>
              {shuffledLetters[0]}
              {shuffledLetters[1]}
              {shuffledLetters[2]}
              {shuffledLetters[3]}
            </div> 
            <div className='bogglebox-spc-board-ltrs-2'>
            {shuffledLetters[4]}
            {shuffledLetters[5]}
            {shuffledLetters[6]}
            {shuffledLetters[7]}

            </div> 
            <div className='bogglebox-spc-board-ltrs-3'>
            {shuffledLetters[8]}
            {shuffledLetters[9]}
            {shuffledLetters[10]}
            {shuffledLetters[11]}

            </div> 
            <div className='bogglebox-spc-board-ltrs-4'>
            {shuffledLetters[12]}
            {shuffledLetters[13]}
            {shuffledLetters[14]}
            {shuffledLetters[15]}

            </div> 
          </div> 
        </div>        
        <div className='bogglebox-spc-timer'>
          
        </div>        
        <div className='bogglebox-spc-menu'>

        </div>
        <div className='bogglebox-spc-input'>
          
        </div>
        <div className='bogglebox-spc-answer'>
          
        </div>
        BoggleBox

      </div>
      <Footer/>
    </div>
  )
}

export default BoggleBox