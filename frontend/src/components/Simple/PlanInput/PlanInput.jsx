import { useState } from 'react'
import { useSelector, useDispatch } from 'react-redux' // access state variables
import { createData } from './../../../features/data/dataSlice'
import './PlanInput.css';
import { toast } from 'react-toastify'                        // visible error notifications


function PlanInput() {
  const [planText, setPlanText] = useState('')
  const [goalText, setGoalText] = useState('')
  const [actionText, setActionText] = useState('')
  const [files, setFiles] = useState([])
  const rootStyle = window.getComputedStyle(document.body);
  const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);
  const dispatch = useDispatch()

  const { user, dataIsError, dataIsSuccess, dataMessage } = useSelector(
    // select plan values from data state
    (state) => state.data
  )

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

    console.log({ data: text, files });

    dispatch(createData(formData));

    setPlanText('');
    setGoalText('');
    setActionText('');
    setFiles([]);
    toast.success("Plan successfully created!", { autoClose: toastDuration })
  }

  const onFilesChange = (e) => {
    setFiles([...e.target.files])
  }

  return (
    <div className='planit-planinput'>
      <form onSubmit={onSubmit}>
        <div className='planit-planinput-group'>
          <textarea
            name='goal'
            id='planit-planinput-input'
            placeholder='Enter goal description, including the delta in the current state and potential financial or other fixed variables for comparison.'
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)} // change text field value
          />
        </div>
        <div className='planit-planinput-group'>
          <textarea
            name='plan'
            id='planit-planinput-input'
            placeholder='Enter plan description including stakeholders, milestones, and other project charter information to meet the project metric.'
            value={planText}
            onChange={(e) => setPlanText(e.target.value)} // change text field value
          />
        </div>
        <div className='planit-planinput-group'>
          <textarea
            name='action'
            id='planit-planinput-input'
            placeholder='Enter action description, detailing the completed steps to achieve the goal metric from the current delta state.'
            value={actionText}
            onChange={(e) => setActionText(e.target.value)} // change text field value
          />
        </div>
        <div className='planit-planinput-group'>
          <input
            type='file'
            multiple
            onChange={onFilesChange}
          />
        </div>
        <div className='planit-planinput-group'>
          <button className='planit-planinput-submit' type='submit'>
            Create Plan
          </button>
        </div>
      </form>
    </div>
  )
}

export default PlanInput
