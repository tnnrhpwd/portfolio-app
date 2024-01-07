import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { updateData, getData, resetDataSlice, deleteData } from '../../../features/data/dataSlice.js';
import { toast } from 'react-toastify';
import Spinner from '../../Spinner/Spinner.jsx';
import NNetBookView from './NNetBookView.jsx';
import TextareaAutosize from 'react-textarea-autosize';
import { ReactComponent as Lightning } from '../../../assets/lightning.svg'; // Adjust the path to match the location of lightning.svg
import './NNetChatView.css';

const NNetChatView = () => {
  const dispatch = useDispatch();
  const [inputText, setInputText] = useState('');
  const [editedText, setEditedText] = useState(''); // New state for edited content
  const [chatHistory, setChatHistory] = useState([]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [priorChats, setPriorChats] = useState([]); // New state for prior chats

  // Get the relevant data from the state
  const { user, data, dataIsSuccess, dataIsLoading, dataIsError, dataMessage, operation } = useSelector(
    (state) => state.data
  );

  // Handle data updates
useEffect(() => {
  console.log("useEffect Triggered in NNetChatView");
  // If there is a new successful response from updateData, update the chat history
  if (operation === 'update' && dataIsSuccess) {
    console.log(data);
    const originalString = data.data[0];
    const dataString = originalString.includes("|Net:") ? originalString.split("|Net:")[1] : originalString;

    if (inputText === '') {
      setChatHistory((prevChatHistory) => [...prevChatHistory, { content: dataString }]);
    } else {
      setChatHistory((prevChatHistory) => [...prevChatHistory, { content: inputText }, { content: dataString }]);
    }
    setInputText('');
    console.log(priorChats);
  }

  // If there is a new successful response from getData, update priorChats
  if (operation === 'get' && dataIsSuccess) {
    setPriorChats(data.data); // Ensure that dataIsSuccess is true before updating priorChats
  }

  // Handle errors
  if (dataIsError) {
    toast.error(dataMessage);
  }

  // Reset the data slice when unmounting or when there's an error
  return () => {
    if (dataIsSuccess || dataIsError) { dispatch(resetDataSlice()); }
  };
}, [dataIsSuccess, dataIsError, dataMessage, operation, dispatch]);

// Additional useEffect for fetching data on component mount
useEffect(() => {
  async function getMyData() {
    try {
      await dispatch(getData({ data: "Net:" }));
    } catch (error) {
      console.error(error);
      toast.error(error);
    }
  }
  getMyData();

  // Reset the data slice when the component unmounts
  return () => {
    dispatch(resetDataSlice());
  };
}, [dispatch]);
  
  const handleSend = async () => {
    try {
      if (!user || user === null) {
        toast.error('Please log in to utilize this API.');
        return;
      }
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
  
  const handleChatClick = (clickedChat) => {    // Replace the entire chat history with the clicked chat
    console.log(chatHistory);
    console.log(clickedChat);
    const chatContent = clickedChat.split("|Net:")[1];
    setChatHistory((prevChatHistory) => [{ content: chatContent }]);  
  };

  const handleDeleteData = async (id) => {
    try {
      await dispatch(deleteData(id)); // Assuming you have the deleteData action in your dataSlice
    } catch (error) {
      console.error(error);
      toast.error('An error occurred while deleting data.');
    }
  };
  
  const handleUpdateData = async (id, originalContent) => {
    try {
      const updatedContent = `${originalContent} [Archived]`;
      await dispatch(updateData({ id, data: updatedContent })); // Assuming you have the updateData action in your dataSlice
    } catch (error) {
      console.error(error);
      toast.error('An error occurred while updating data.');
    }
  };
  
  const handleCopyToClipboard = (content) => {
    try {
      // Use the Clipboard API to copy content to the clipboard
      navigator.clipboard.writeText(content);
      toast.success('Content copied to clipboard!');
    } catch (error) {
      console.error(error);
      toast.error('An error occurred while copying to clipboard.');
    }
  };
  
  return (
    <div className='planit-nnet-chat'>
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
                <div className='planit-nnet-chat-history-edit-div'>
                  <button className='planit-nnet-chat-history-edit-buttons' onClick={() => handleSaveEdit(index)}>Save</button>
                  <button className='planit-nnet-chat-history-edit-buttons' onClick={handleCancelEdit}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div className='planit-nnet-chat-history-message-content'>{item.content}</div>
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
          className='planit-nnet-chat-area'
        />
        <button
          onClick={handleSend}
          disabled={dataIsLoading}
          id='planit-nnet-chat-gobutton'
        >
          <Lightning className="planit-nnet-chat-gobutton-light" />
        </button>
      </div>
      <NNetBookView
        myChats={priorChats}
        onChatClick={handleChatClick}
        onDeleteData={handleDeleteData}
        onUpdateData={handleUpdateData}
        onCopyToClipboard={handleCopyToClipboard}
      />
      {dataIsLoading && <Spinner />}
    </div>
  );
};

export default NNetChatView;