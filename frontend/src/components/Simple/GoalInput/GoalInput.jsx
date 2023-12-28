import { useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'      // access state variables
import { createData } from './../../../features/data/dataSlice'
import './GoalInput.css';

function GoalInput() {
    const [stext, setSText] = useState('')

    const dispatch = useDispatch()  // initialization

    const { user, dataIsError, dataIsSuccess, dataMessage } = useSelector(     // select goal values from data state
    (state) => state.data
  )

    const onSubmit = (e) => {
        e.preventDefault()
        const text = 'Creator:'+user._id+'|Goal:'+stext
        console.log({ data: text })
        dispatch(createData({ data: text }))   // dispatch connects to the store, then creates a goal with text input
        setSText('')                      // empty text field 
        // toast.success("Goal successfully created!", { autoClose: 1000 })
    }

    return (
        <div className='planit-goalinput'>
            <form onSubmit={onSubmit}>
                <div className='planit-goalinput-group'>
                <textarea
                    name='text'
                    id='planit-goalinput-input'
                    placeholder='Enter goal description including stakeholders, milestones, and other project charter information.'
                    value={stext}
                    onChange={(e) => setSText(e.target.value)}   // change text field value
                />
                </div>
                <div className='planit-goalinput-group'>
                <button className='planit-goalinput-submit' type='submit'>
                    Submit
                </button>
                </div>
            </form>
        </div>
    )
}

export default GoalInput