import { useState, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { createData } from '../../../features/data/dataSlice';
import './PlanInput.css';
import { toast } from 'react-toastify';

function PlanInput() {
  const [planText, setPlanText] = useState('');
  const [goalText, setGoalText] = useState('');
  const [actionText, setActionText] = useState('');
  const [files, setFiles] = useState([]);
  const fileInputRef = useRef(null);
  const rootStyle = window.getComputedStyle(document.body);
  const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);
  const dispatch = useDispatch();

  const { user } = useSelector((state) => state.data);

  const onSubmit = async (e) => {
    e.preventDefault();
    let text = `Creator:${user._id}`;
    if (planText) text += `|Plan:${planText}`;
    if (goalText) text += `|Goal:${goalText}`;
    if (actionText || files.length > 0) text += `|Action:${actionText}`;
    
    const formData = new FormData();
    formData.append('data', text);
    files.forEach(file => {
      formData.append('files', file);
    });

    dispatch(createData(formData));

    setPlanText('');
    setGoalText('');
    setActionText('');
    setFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    toast.success("Plan successfully created!", { autoClose: toastDuration });
  };

  const onFilesChange = (e) => {
    setFiles([...e.target.files]);
  };

  return (
    <div className='planit-planinput'>
      <form onSubmit={onSubmit}>
        <div className='planit-planinput-group'>
          <textarea
            name='goal'
            id='planit-planinput-input'
            placeholder='Enter goal description...'
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
          />
        </div>
        <div className='planit-planinput-group'>
          <textarea
            name='plan'
            id='planit-planinput-input'
            placeholder='Enter plan description...'
            value={planText}
            onChange={(e) => setPlanText(e.target.value)}
          />
        </div>
        <div className='planit-planinput-group'>
          <textarea
            name='action'
            id='planit-planinput-input'
            placeholder='Enter action description...'
            value={actionText}
            onChange={(e) => setActionText(e.target.value)}
          />
        </div>
        <div className='planit-planinput-group'>
          <input
            type='file'
            id='file-input'
            multiple
            onChange={onFilesChange}
            ref={fileInputRef}
          />
        </div>
        <div className='planit-planinput-group'>
          <button className='planit-planinput-submit' type='submit'>
            Create Plan
          </button>
        </div>
      </form>
    </div>
  );
}

export default PlanInput;
