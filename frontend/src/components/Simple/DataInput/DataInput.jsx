import { useState, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { createData } from '../../../features/data/dataSlice';
import './DataInput.css';
import { toast } from 'react-toastify';
import { processFilesWithCompression } from '../../../utils/imageCompression';

function DataInput() {
  const [planText, setPlanText] = useState('');
  const [goalText, setGoalText] = useState('');
  const [actionText, setActionText] = useState('');
  const [files, setFiles] = useState([]);
  const [isPublic, setIsPublic] = useState(false);
  const [cost, setCost] = useState('');
  const [costType, setCostType] = useState('one-time');
  const fileInputRef = useRef(null);
  const rootStyle = window.getComputedStyle(document.body);
  const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);
  const dispatch = useDispatch();

  const { user } = useSelector((state) => state.data);

  const onSubmit = async (e) => {
    e.preventDefault();
    
    const parts = [];
    if (cost) {
      parts.push(`Cost:$${parseFloat(cost).toFixed(2)}`);
      parts.push(`CostType:${costType}`);
    }
    
    console.log('planText:', planText, 'goalText:', goalText, 'actionText:', actionText, 'files:', files);

    if (planText) parts.push(`Plan:${planText}`);
    if (goalText) parts.push(`Goal:${goalText}`);
    // Ensure Action field is added if there's actionText or files are present.
    // If actionText is empty but files exist, it will add "Action:"
    if (actionText || files.length > 0) parts.push(`Action:${actionText}`);
    if (isPublic) parts.push(`Public:${isPublic}`);
    
    const text = parts.join('|');

    const formData = new FormData();
    formData.append('data', text); // Send the content string without the Creator prefix
    files.forEach(file => {
      formData.append('files', file);
    });

    // Append an empty files array if no files are selected
    if (files.length === 0) {
      // If you intend to send an empty array for 'files' field when no files are selected:
      // formData.append('files', new Blob([], { type: 'application/json' }), ''); // This is one way for an empty file entry
      // However, backend postHashData.js currently expects 'files' to be actual file objects from multer.
      // If 'files' field in FormData is just an empty string or empty array string, multer might not process it as req.files.
      // The current backend logic for filesData prioritizes req.files.
      // If no files are uploaded, req.files will be empty or undefined, and filesData will remain [].
      // So, explicitly appending an empty 'files' field might not be necessary if no files are selected.
      // The backend handles filesData = [] if req.files is empty.
      // Let's remove the explicit formData.append('files', []) for now as it might be causing `req.body.files = ""`
      // which was then confusingly parsed in postHashData.js.
      // Multer will simply not populate req.files if no files are sent with the 'files' key.
    }

    // Log FormData contents correctly
    console.log('FormData contents:');
    for (const pair of formData.entries()) {
      console.log(pair[0] + ', ' + pair[1]);
    }

    dispatch(createData(formData));

    setPlanText('');
    setGoalText('');
    setActionText('');
    setFiles([]);
    setIsPublic(false);
    setCost('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    toast.success("Plan successfully created!", { autoClose: toastDuration });
  };

  const onFilesChange = async (e) => {
    const selectedFiles = [...e.target.files];
    
    if (selectedFiles.length === 0) {
      setFiles([]);
      return;
    }
    
    console.log(`Files selected: ${selectedFiles.length}`);
    selectedFiles.forEach(file => {
      console.log(`- ${file.name}: ${Math.round(file.size/1024)}KB, type: ${file.type}`);
    });
    
    try {
      // Process files with automatic compression
      const processedFiles = await processFilesWithCompression(selectedFiles, {
        maxFileSize: 280 * 1024, // 280KB per file
        maxTotalSize: 350 * 1024, // 350KB total
        useAPI: false // Set to true if you want to use external API compression
      });
      
      if (processedFiles.length > 0) {
        setFiles(processedFiles);
        toast.success(`✅ ${processedFiles.length} file(s) ready for upload!`, { autoClose: 2000 });
      } else {
        // Clear file input if no files were processed successfully
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        setFiles([]);
      }
    } catch (error) {
      console.error('Error processing files:', error);
      toast.error('Failed to process files. Please try again.');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setFiles([]);
    }
  };

  return (
    <div className='planit-datainput'>
      <form onSubmit={onSubmit}>
        <div className='planit-datainput-group'>
          <textarea
            name='goal'
            id='planit-datainput-input'
            placeholder='Enter goal description...'
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
          />
        </div>
        <div className='planit-datainput-group'>
          <textarea
            name='plan'
            id='planit-datainput-input'
            placeholder='Enter plan description...'
            value={planText}
            onChange={(e) => setPlanText(e.target.value)}
          />
        </div>
        <div className='planit-datainput-group'>
          <textarea
            name='action'
            id='planit-datainput-input'
            placeholder='Enter action description...'
            value={actionText}
            onChange={(e) => setActionText(e.target.value)}
          />
        </div>
        <div className='planit-datainput-group'>
          <input
            type='number'
            step='0.01'
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder='Enter cost in USD'
          />
          <select value={costType} onChange={(e) => setCostType(e.target.value)}>
            <option value='one-time'>one-time</option>
            <option value='monthly'>monthly</option>
            <option value='/call'>/call</option>
          </select>
        </div>
        <div className='planit-datainput-group'>
          <label htmlFor='file-input'>Files (Images auto-compressed to fit limits):</label>
          <input
            type='file'
            id='file-input'
            multiple
            accept="image/*,.pdf,.txt,.doc,.docx"
            onChange={onFilesChange}
            ref={fileInputRef}
          />
          {files.length > 0 && (
            <div className='file-info' style={{marginTop: '10px', fontSize: '12px'}}>
              {files.map((file, index) => (
                <div key={index} className='file-item'>
                  {file.type.startsWith('image/') ? '�' : '�📄'} {file.name} ({Math.round(file.size/1024)}KB)
                </div>
              ))}
              <div className='total-size' style={{fontWeight: 'bold', marginTop: '5px', color: files.reduce((sum, file) => sum + file.size, 0) > 350 * 1024 ? 'red' : 'green'}}>
                Total: {Math.round(files.reduce((sum, file) => sum + file.size, 0)/1024)}KB / 350KB
              </div>
            </div>
          )}
        </div>
        <div className='planit-datainput-group'>
          <label>
            <input
              type='checkbox'
              className='planit-datainput-group-check'
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            <div className='planit-datainput-group-public'>Public</div>
          </label>
        </div>
        <div className='planit-datainput-group'>
          <button className='planit-datainput-submit' type='submit'>
            Create Plan
          </button>
        </div>
      </form>
    </div>
  );
}

export default DataInput;