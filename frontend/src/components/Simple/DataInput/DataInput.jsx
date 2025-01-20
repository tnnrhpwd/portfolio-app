import { useState, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { createData } from '../../../features/data/dataSlice';
import './DataInput.css';
import { toast } from 'react-toastify';

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
    let text = `Creator:${user._id}`;
    if (cost) {
      text += `|Cost:$${parseFloat(cost).toFixed(2)}`;
      text += `|CostType:${costType}`;
    }
    if (planText) text += `|Plan:${planText}`;
    if (goalText) text += `|Goal:${goalText}`;
    if (actionText || files.length > 0) text += `|Action:${actionText}`;
    if (isPublic) text += `|Public:${isPublic}`;
    
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
    setIsPublic(false);
    setCost('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    toast.success("Plan successfully created!", { autoClose: toastDuration });
  };

  const onFilesChange = (e) => {
    setFiles([...e.target.files]);
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
          <input
            type='file'
            id='file-input'
            multiple
            onChange={onFilesChange}
            ref={fileInputRef}
          />
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