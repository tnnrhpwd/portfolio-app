import { useState } from 'react'
import { useSelector, useDispatch } from 'react-redux' // access state variables
import { createData } from '../../../features/data/dataSlice'
import './ActionInput.css';

function ActionInput() {
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
    <div className='actioninput'>
      <form onSubmit={onSubmit}>
        <div className='actioninput-group'>
          <textarea
            name='text'
            id='actioninput-input'
            placeholder='What have you done this week to reach your goals?'
            value={stext}
            onChange={(e) => setSText(e.target.value)} // change text field value
          />
        </div>
        <div className='actioninput-group'>
          <button className='actioninput-submit' type='submit'>
            Submit
          </button>
        </div>
      </form>
    </div>
  )
}

export default ActionInput
