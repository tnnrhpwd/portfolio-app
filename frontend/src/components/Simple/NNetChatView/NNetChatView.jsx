import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { updateData, resetDataSlice } from '../../../features/data/dataSlice.js';
import { toast } from 'react-toastify';
import Spinner from '../../Spinner/Spinner.jsx';
import NNetBookView from './NNetBookView.jsx';
import TextareaAutosize from 'react-textarea-autosize';
import './NNetChatView.css';

const NNetChatView = () => {
  const dispatch = useDispatch();
  const [inputText, setInputText] = useState('');
  const [editedText, setEditedText] = useState(''); // New state for edited content
  const [chatHistory, setChatHistory] = useState([]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [bookIsOpen, setBookIsOpen] = useState(false);

  // Get the relevant data from the state
  const { data, dataIsSuccess, dataIsLoading, dataIsError, dataMessage } = useSelector(
    (state) => state.data
  );

  // Handle data updates
  useEffect(() => {
    // If there is a new successful response, update the chat history
    if (dataIsSuccess) {
      console.log(data)
      if (inputText === '') {
        setChatHistory([...chatHistory, { content: data }]);
      } else {
        setChatHistory([...chatHistory, { content: inputText }, { content: data }]);
      }
      setInputText('');
    }

    // Handle errors
    if (dataIsError) {
      toast.error(dataMessage);
    }

    // Reset the data slice when unmounting or when there's an error
    return () => {
      dispatch(resetDataSlice());
    };
  }, [dispatch, dataIsSuccess, dataIsError, dataMessage, data, inputText, chatHistory]);

  const handleSend = async () => {
    try {
      // Concatenate prior messages with the current inputText
      const combinedData = chatHistory.map((item) => item.content).concat(inputText).join('\n');

      // Dispatch the updateData action with the inputText
      dispatch(updateData({ id: 'u', data: combinedData }));
    } catch (error) {
      // Handle any errors here
      console.error(error);
      toast.error('An error occurred while fetching data from OpenAI.');
    }
  };

  const handleBook = async () => {
    try {
      if(bookIsOpen){setBookIsOpen(false)}else{setBookIsOpen(true)}
      console.log(bookIsOpen)
    } catch (error) {
      // Handle any errors here

    }
  };

  const handleEdit = (index) => {
    setEditingIndex(index);
    setEditedText(chatHistory[index].content); // Set the edited text
  };

  const handleSaveEdit = (index) => {
    // Update the chatHistory with the edited content
    const updatedHistory = [...chatHistory];
    updatedHistory[index].content = editedText;
    setChatHistory(updatedHistory);
    setEditingIndex(null);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditedText(''); // Reset the edited text
  };

  const handleDelete = (index) => {
    const updatedHistory = [...chatHistory];
    updatedHistory.splice(index, 1);
    setChatHistory(updatedHistory);
  };

  const handleMainKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); // Prevents a new line from being added
      handleSend();
    }
  };

  const handleEditKeyDown = (e, index) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); // Prevents a new line from being added
      handleSaveEdit(index);
    }
  };
  
  return (
    <div className='planit-dashboard-popular-mid-chat'>
      <div className='planit-nnet-chat-history'>
        {chatHistory.map((item, index) => (
          <div key={index} className='planit-nnet-chat-history-message'>
            {editingIndex === index ? (
              <>
                <TextareaAutosize
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  onKeyDown={(e) => handleEditKeyDown(e, index)} // Pass the index
                  className='planit-nnet-chat-history-edit'
                />
                <div>
                  <button className='planit-nnet-chat-history-edit-buttons' onClick={() => handleSaveEdit(index)}>Save</button>
                  <button className='planit-nnet-chat-history-edit-buttons' onClick={handleCancelEdit}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div>{item.content}</div>
                <div className='planit-nnet-chat-history-buttons'>
                  <button onClick={() => handleEdit(index)}>Edit</button>
                  <button onClick={() => handleDelete(index)}>Delete</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <div className='planit-nnet-input'>
        <TextareaAutosize
          value={inputText}
          placeholder='Input text.'
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleMainKeyDown} // Add the keydown event handler
          className='planit-dashboard-popular-mid-chat-area'
        />
        <button
          onClick={handleSend}
          disabled={dataIsLoading}
          id='planit-dashboard-popular-mid-chat-gobutton'
        >
          ⚡
        </button>
      </div>
      <NNetBookView/>
      {dataIsLoading && <Spinner />}
      </div>
  );
};

export default NNetChatView;