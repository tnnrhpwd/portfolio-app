import { useState } from 'react'
import { useSelector, useDispatch } from 'react-redux' // access state variables
import { createData } from './../../../features/data/dataSlice'
import './PlanInput.css';

function PlanInput() {
  const [stext, setSText] = useState('')

  const dispatch = useDispatch() // initialization

  const { user, dataIsError, dataIsSuccess, dataMessage } = useSelector(
    // select plan values from data state
    (state) => state.data
  )

  const onSubmit = (e) => {
    e.preventDefault()
    const text = 'Creator:' + user._id + '|Plan:' + stext
    console.log({ data: text })
    dispatch(createData({ data: text })) // dispatch connects to the store, then creates a plan with text input
    setSText('') // empty text field
    // toast.success("Plan successfully created!", { autoClose: 1000 })
  }

  return (
    <div className='planit-planinput'>
      <form onSubmit={onSubmit}>
        <div className='planit-planinput-group'>
          <textarea
            name='text'
            id='planit-planinput-input'
            placeholder='Enter plan description including stakeholders, milestones, and other project charter information.'
            value={stext}
            onChange={(e) => setSText(e.target.value)} // change text field value
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
