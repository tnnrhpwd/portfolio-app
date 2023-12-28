import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'              // redirect the user
import { useSelector, useDispatch } from 'react-redux'      // access state variables
import GoalResult from './../../components/GoalResult/GoalResult.jsx';
import Spinner from './../../components/Spinner/Spinner.jsx'
import { getGoals, resetGoalSlice } from './../../features/goals/goalSlice'

function LeftDashboard() {
    const navigate = useNavigate() // initialization
    const dispatch = useDispatch() // initialization
  
    const { user } = useSelector((state) => state.auth)      // select user values from user state
    const { goals, goalIsLoading, goalIsError, goalMessage } = useSelector(     // select goal values from goal state
        (state) => state.goals
    )
  
    // called on state changes
    useEffect(() => {
        if (goalIsError) {
        console.log(goalMessage)
        }
    
        // if (!user) {            // if no user, redirect to login
        //   navigate('/login') 
        // }
    
        dispatch(getGoals()) // dispatch connects to the store, then retreives the goals that match the logged in user.
    
        return () => {    // reset the goals when state changes
        dispatch(resetGoalSlice()) // dispatch connects to the store, then reset state values( goalMessage, isloading, iserror, and issuccess )
        }
    }, [user, navigate, goalIsError, goalMessage, dispatch])

    if (goalIsLoading) {
        return <Spinner />
    }

    return (
        <div className='planit-dashboard-popular-left'>
            Popular Goals 
            <div className='planit-dashboard-popular-left-goals'>
            {goals.length > 0 ? (
                <div className='planit-goals-out-result'>
                {goals.map((goal) => (
                    <GoalResult key={goal._id} goal={goal} />
                ))}
                </div>
            ) : (
                <h3>You have not set any goals</h3>
            )}
            </div>
        </div>
    )
}

export default LeftDashboard