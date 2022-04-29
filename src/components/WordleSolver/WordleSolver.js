import React, { useState } from 'react'
import { useEffect } from 'react';
import url from "./Dictionary.txt";
// import url from "https://drive.google.com/uc?export=download&id=1-sEDU_ookViibMB7-SwgshnXDtCE6fVv";
import "./WordleSolver.css";
import Footer from './../Footer/Footer';
// const url = "https://content-na.drive.amazonaws.com/cdproxy/templink/I6PcBtI5fx_kRQlY-0k3Kc8hoKsgQEfPR50WjzTkWewpX92IB/alt/pdf?";
// https://drive.google.com/comments/u/0/d/AAHRpnXv1Ss1BbQBd86pWaMJQUH65547S3SZa1DyviclPQ29tjWOtIxuyzy3xJQL0gfieWIR5p4lx_HaudfhjpJNslmE-VdF9Yw/docos/p/sync?id=AAHRpnXv1Ss1BbQBd86pWaMJQUH65547S3SZa1DyviclPQ29tjWOtIxuyzy3xJQL0gfieWIR5p4lx_HaudfhjpJNslmE-VdF9Yw&reqid=0&sid=3911de615435e559&c=0&w=0&flr=0&token=AGNctVZ-AzBPC0-3N4_omAt2Cog1MV-TAw:1650554956706
// https://drive.google.com/viewerng/text?id=ACFrOgAAR09VZb_hIPZ_LGT3sG8pA_mvxBpwcTiVTQR4moGbX4Sqh9UgUk9bsgcWS9XbosSvSm5vNAH-6DpS_itUocvy_rJ-y28PM3NQjzBEcQnN4kGBpFZKzWiAY1RKTU4EGQpfhVy2mE1PAJtm&authuser=0&page=0
// https://drive.google.com/uc?export=download&id=1-sEDU_ookViibMB7-SwgshnXDtCE6fVv
var Dictionary=[];

// Declare and Initiate variables
var inputString; // variable used to catch inputstring
let guessWord=""; // variable used to store word guessed
let guessResult;     // variable used to store numbers returned

var buttonPressNum=0; // what number button press - incremented 
var wordNum=1;  // how many words have been guessed
var wordLength; // length of answer string
var wordArray=[]; // array of possible answers - filled on first button press - filtered every EVEN button press.
let neededChars =[]; // characters that are definitely in the answer



// fills the dictionary with words
function fetchDectionary() {
    fetch(url)
    .then(response => response.text())
    .then(data => {
        console.log(data);
        Dictionary=data.toUpperCase();
        Dictionary=Dictionary.split('\r\n');            // this works local but not in-build
        if(!(Dictionary[0]==="AA")){                    // backup splitter
            Dictionary=Dictionary[0].split("\n");
        }
    })
    .catch(err => console.log(err));
}


function WordleSolver() {
    const [output, setOutput] = useState(null);
    const [instruction, setInstruction] = useState("Enter your first word.");
    const [inputText, setInputText] = useState("");
    const [postInstruction, setPostInstruction] = useState("");

    // fills the dictionary array with words on the intial load.
    useEffect(() => {
        fetchDectionary();
    }, []);

    // This function is called on keyboard presses.    
    const submitForm = (event) =>{
        if (event.key === 'Enter') {
            pressButton();
        }
    }    

    // This function resets the program without reloading it.
    function resetData() {
        buttonPressNum=0; // what number button press - incremented 
        wordNum=1;  // how many words have been guessed
        wordArray=[]; // array of possible answers - filled on first button press - filtered every EVEN button press.
        neededChars =[]; // characters that are definitely in the answer
        setOutput(null);
        setInstruction("Enter your first word.");
        setInputText("");
        setPostInstruction("");
    }

    //This function is called on each button press or ENTER press => filters array on every even# execution
    function pressButton() {
        setPostInstruction('');

        // initiate variable with textbox data
        inputString =inputText;
        // Clear the textbox
        setInputText("");
        
        // Guard clause - Empty
        if(inputString===""){
            // output the error
            setPostInstruction("Enter characters into the text box."); // output
            return
        }
        // Guard clause - numbers
        var hasNumber = /\d/;
        if(hasNumber.test(inputString)&&(buttonPressNum%2===0)){
            // output the error
            setPostInstruction("Enter only letters in the field. An example is: house"); // output
            return
        }
        // Guard clause - letters
        var hasLetter = /[a-zA-Z]/g;
        if(hasLetter.test(inputString)&&(buttonPressNum%2===1)){
            // output the error
            setPostInstruction("Enter only numbers in the field. An example is: 31223"); // output
            return
        }
        // Guard clause - correct word length
        if(!(inputString.length===wordLength)&&(buttonPressNum>0)){
            // output the error
            setPostInstruction("Error: Please enter "+wordLength+" characters. This number was set on your first input."); // output
            return
        }

        // increment counter to record # of guesses
        buttonPressNum++;  

        // ODD PRESSES
        if((buttonPressNum%2===1)){     

            // first press
            if((buttonPressNum===1)){   
                //collect word length                                                 
                wordLength=inputString.length;
                Dictionary.forEach(wrd => { // fills array with length fitting words.
                    if(wrd.length===wordLength){
                        wordArray.push(wrd);    // once words are added, the rest of the program will remove non-conforming words.
                    }
                });
            }

            // Stores the guess from the textbox
            guessWord=inputString.toUpperCase(); 

            // Display text for Even button press input
            setInstruction("Enter the #"+wordNum+" word results replacing green, orange, and black with 123 respectively."); // instruction

            // increment 
            wordNum++;
        }
        // EVEN PRESSES
        if(buttonPressNum%2===0){       

            // Stores the numbers from the textbox
            guessResult=inputString; 

            // Removes bad words from returned array
            filterArr(wordArray,guessWord,guessResult); 

            // Display text for odd button press input
            setInstruction("Enter the #"+wordNum+" word."); // instruction
        }
        // END OF GAME
        if(wordNum>9){
            // instruction GAME OVER text assignment
            setOutput("Game Over."); 
            // setTimeout(function(){
                // window.location.reload(); // reload the page after 3 seconds
            // }, 3000);
        }
    }
    
    // This function filters an array using a guess and result, printing the results
    function filterArr(array1,guessWord,guessResult) {
        // temporary array that stores potential words
        let words254=[]; 
        // list of characters definitely in the answer
        neededChars =[]; 






        //For each word of the inputed array
        array1.forEach(word => {
            // Initiate Tests
            let greenTest=true; let orangeTest=true; let blackTest=true;

            // for each letter of each word of the input array
            for (let col=0;col<wordLength;col++){

                // if the letter in your guess at that corresponding spot was correct
                if(guessResult.charAt(col)==='1'){
                    
                    // if the letter of the word in the input array matches the correct character 
                    if((word.charAt(col)===guessWord.charAt(col))){
                        
                        // if the correct character is not in the need characters array, add it.
                        if(!neededChars.includes(guessWord.charAt(col))){
                            // Add correct character to needed characters array
                            neededChars.push(guessWord.charAt(col));
                        }
                    }
                    else {
                        greenTest=false;
                    }
                }
                // if the letter in your guess at that corresponding spot was orange
                if(guessResult.charAt(col)==='2'){
                    if(!neededChars.includes(guessWord.charAt(col))){
                        neededChars.push(guessWord.charAt(col));
                    }
                    if(word.charAt(col)===guessWord.charAt(col)){ //if orange letter is in same spot
                        orangeTest=false;
                    }
                    //checks for orange letter in rest of potential word
                    if(!(word.includes(guessWord.charAt(col)))){
                        orangeTest=false;
                    }
                }
                // if the letter in your guess at that corresponding spot was black
                if(guessResult.charAt(col)==='3'){

                    // if potential word contains black letter
                    if((word.includes(guessWord.charAt(col)))){ 

                        // if black letter is also orange/green, ---- This happens when more of a certain character are in the guess than the answer
                        if (neededChars.includes(guessWord.charAt(col))){ 

                            // Initialize counts of the certain letter for each word
                            let guessLetterCount =0;
                            let listLetterCount =0;

                            // for loop with length of answer
                            for (let ltttr=0;ltttr<wordLength;ltttr++) {

                                // count how many times that certain character appears in the guess
                                if((guessWord.charAt(ltttr)===word.charAt(col))&&((guessResult==="1")||(guessResult==="2"))){
                                    guessLetterCount++;
                                }
                                // count how many times that certain character appears in the potential word
                                if((word.charAt(ltttr)===word.charAt(col))&&((guessResult==="1")||(guessResult==="2"))){
                                    listLetterCount++;
                                }
                            }
                            // if the count of that certain character is the same in the guess and potenial word
                            if(guessLetterCount===listLetterCount){;}else{blackTest=false;}
                        // if blacked letter is not also orange/green, fail word.
                        } else {blackTest=false;} 
                    }
                }
            }
            // If the potential word passes all the tests, add it to the temporary array
            if(greenTest&&orangeTest&&blackTest) {words254.push(word);}
        });
        
        wordArray=[]; // wipe old list of words
        // Move the words from the temporary array to wordArray
        words254.forEach(wdee => {
            wordArray.push(wdee); 
        });

        //output the results
        setOutput("List of potential words: "+wordArray); // output








    }

    return (
        <div>
            <body className="containerq">
                <div id="title">
                    Wordle Solver
                </div>
                <div id="description">
                    Get a list of words that fit your Wordle criteria.
                </div>
                <div id="instruction">
                    {instruction}
                </div>
                <div id="inputs">
                    <input type="text" id="inputTEXT" onChange={e => setInputText(e.target.value)} value={inputText} onKeyDown={submitForm}/>
                    <br></br>
                    <button id="button" onClick={pressButton} >📕Enter</button>
                    <button id="button" onClick={resetData} >Reset</button>
                    <a href="/wordle" target="_blank">
                        <button id="button">Open Wordle</button>
                    </a>
                </div>
                <div id="postInstruction">
                    {postInstruction}
                </div>
                <div id="output">
                    {output}
                </div>
                <a href="https://github.com/tnnrhpwd/portfolio-app/tree/master/src/components/WordleSolver" rel="noreferrer" target="_blank">
                    <button id="button">⚙ View Source Code ⚙</button>
                </a>
            </body>
            <Footer/>
        </div>
    )
}

export default WordleSolver;