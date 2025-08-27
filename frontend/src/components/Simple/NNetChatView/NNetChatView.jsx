import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { getData, compressData, updateData, resetDataSlice, deleteData } from '../../../features/data/dataSlice.js';
import { toast } from 'react-toastify';
import Spinner from '../../Spinner/Spinner.jsx';
import NNetBookView from './NNetBookView.jsx';
import TextareaAutosize from 'react-textarea-autosize';
import { ReactComponent as Lightning } from '../../../assets/lightning.svg'; // Adjust the path to match the location of lightning.svg
import './NNetChatView.css';

const NNetChatView = () => {
  const rootStyle = window.getComputedStyle(document.body);
  const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [inputText, setInputText] = useState('');
  const [editedText, setEditedText] = useState(''); // New state for edited content
  const [chatHistory, setChatHistory] = useState([]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [priorChats, setPriorChats] = useState([]); // New state for prior chats
  const [activeChat, setActiveChat] = useState(null);

  // Get the relevant data from the state
  const { user, data, dataIsSuccess, dataIsLoading, dataIsError, dataMessage, operation } = useSelector(
    (state) => state.data
  );

  useEffect(() => {  // Handle compressData updates
    // If there is a new successful response from compressData, update the chat history
    if (operation === 'compress' && dataIsSuccess && data.data) {
      const compressedResponse = data.data[0];
      setChatHistory((prevChatHistory) => [...prevChatHistory, { content: compressedResponse }]);
      setInputText('');
    }

    // Handle errors
    if (dataIsError) {
      if (dataMessage && !dataMessage.includes('token')) {
          toast.error(dataMessage, { autoClose: toastDuration });
        }
    }

    // Reset the data slice when unmounting or when there's an error
    return () => {
      if (dataIsSuccess || dataIsError) { dispatch(resetDataSlice()); }
    };
  }, [dataIsSuccess, dataIsError, dataMessage, operation, dispatch, data, toastDuration]);

  useEffect(() => {  // Handle getData updates
    // If there is a new successful response from getData, update priorChats
    if (operation === 'get' && dataIsSuccess) {
      console.log('getData response:', data.data);
      let tempPriorChats = [];
      data.data.forEach((item) => {
        // Backend returns data directly in item.data, not item.data.text
        if (item.data && item.data.includes('|Net:')) {
          tempPriorChats.push({
            ...item,
            data: { text: item.data } // Restructure to match expected format
          });
        }
      });

      console.log('Processed priorChats:', tempPriorChats);
      setPriorChats(tempPriorChats); // Ensure that dataIsSuccess is true before updating priorChats
    }

    // Handle errors
    if (dataIsError) {
      if (dataMessage && !dataMessage.includes('token')) {
          console.error(dataMessage);
          toast.error(dataMessage, { autoClose: toastDuration });
        }
    }

    // Reset the data slice when unmounting or when there's an error
    return () => {
      if (dataIsSuccess || dataIsError) { dispatch(resetDataSlice()); }
    };
  }, [dataIsSuccess, dataIsError, dataMessage, operation, dispatch, data, toastDuration]);

  useEffect(() => {  // Fetch data with |Net: on component mount
    async function getMyData() {
      try {
        if (!user || user === null) {
          toast.info('Please login first.', { autoClose: toastDuration });
          navigate('/login')  
          return;
        }
        await dispatch(getData({ data: { text: "|Net:" } }));
      } catch (error) {
        console.error(error);
        toast.error(error, { autoClose: toastDuration });    
      }
    }
    getMyData();

    // Reset the data slice when the component unmounts
    return () => {
      dispatch(resetDataSlice());
    };
  }, [dispatch, toastDuration, user, navigate]);

  const handleSend = async () => {
    try {
      if (!user || user === null) {
        toast.error('Please log in to utilize this API.', { autoClose: toastDuration });
        return;
      }
      // Concatenate prior messages with the current inputText
      const combinedData = chatHistory.map((item) => item.content).join('\n') + (inputText ? '\n' + inputText : '');

      // Check if the combinedData contains only '\n' or is an empty string
      if (/^\s*$/.test(combinedData)) {
        toast.error('Please enter some text before sending.', { autoClose: toastDuration });
        return;
      }

      console.log(activeChat);
      let activeChatItem = JSON.parse(JSON.stringify(activeChat)); // Create a deep copy of the activeChat object
      console.log(activeChatItem);
      const inputTextString = inputText ? inputText : '';
      console.log(inputTextString);
      if(activeChat){
        console.log("activeChatItem.data.text");
        activeChatItem.data.text = activeChatItem.data.text + "\n" + inputTextString;
        console.log(activeChatItem.data.text);
        setActiveChat(activeChatItem);
        setChatHistory((prevChatHistory) => [...prevChatHistory, { content: inputText }]); // Update the chat history
        // Dispatch the compressData action with the combinedData
        dispatch(compressData({ data: JSON.stringify(activeChatItem) }));
      }else{
        let chatItem = { data: { text: inputTextString } };
        console.log(chatItem);
        // Dispatch the compressData action with the combinedData
        dispatch(compressData({ data: JSON.stringify(chatItem) }));
        setChatHistory((prevChatHistory) => [...prevChatHistory, { content: inputText }]); // Update the chat history

      }
      

    } catch (error) {
      // Handle any errors here
      console.error(error);
      toast.error('An error occurred while fetching data from OpenAI.', { autoClose: toastDuration });
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

  const handleNewChat = () => {
    setActiveChat(null);
    setChatHistory([]);
  };

  const handleChatClick = (clickedChat) => {
    setActiveChat(clickedChat); // Assuming that each chat object has an 'id' property
    console.log('Clicked chat:', clickedChat);
    // Extract the chat content after |Net: token
    const chatContent = clickedChat.data.text.split("|Net:")[1];
    console.log('Extracted chat content:', chatContent);
    
    // Parse the chat content to recreate the conversation history
    const lines = chatContent.split('\n').filter(line => line.trim());
    const chatMessages = [];
    
    for (let i = 0; i < lines.length; i++) {
      chatMessages.push({ content: lines[i] });
    }
    
    setChatHistory(chatMessages);
  };

  const handleDeleteData = async (id) => {
    try {
      await dispatch(deleteData(id)); // Assuming you have the deleteData action in your dataSlice
    } catch (error) {
      console.error(error);
      toast.error('An error occurred while deleting data.', { autoClose: toastDuration });
    }
  };

  const handleUpdateData = async (index, originalContent) => {
    try {
      const updatedContent = `${originalContent.content} [Archived]`;
      await dispatch(updateData({ id: originalContent.id, data: updatedContent }));
    } catch (error) {
      console.error(error);
      toast.error('An error occurred while updating data.', { autoClose: toastDuration });
    }
  };

  const handleCopyToClipboard = (content) => {
    try {
      // Use the Clipboard API to copy content to the clipboard
      navigator.clipboard.writeText(content);
      toast.success('Content copied to clipboard!', {autoClose: toastDuration});
    } catch (error) {
      console.error(error);
      toast.error('An error occurred while copying to clipboard.', { autoClose: toastDuration });
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
          onKeyDown={handleMainKeyDown}
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
        activeChatId={activeChat} // Pass down the active chat ID
        onNewChat={handleNewChat}
      />
      {dataIsLoading && <Spinner />}
    </div>
  );
};

export default NNetChatView;