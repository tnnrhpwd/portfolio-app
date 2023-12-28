// import GoalInput from './../../components/GoalInput/GoalInput.jsx';
// import { getPlans, resetPlanSlice } from './../../features/plans/planSlice'
// import LeftDashboard from './LeftDashboard.jsx';
import MiddleDashboard from './MiddleDashboard.jsx';
import Start from './../../../components/Simple/Start/Start.jsx';
import Header from './../../../components/Header/Header';
import React from 'react';
import './Simple.css';

function Simple() {
  return (<>
    <Header/>
    <div className='planit-dashboard'>
      <div className='planit-dashboard-upper'>
        <header className='planit-dashboard-upper-header'>
          Dream bigger!
        </header>
        {/* <Start/> */}
      </div>
      {/* <div className='planit-dashboard-popular'> */}
        {/* <LeftDashboard/> */}
        {/* <MiddleDashboard/> */}
        {/* <div className='planit-dashboard-popular-right'>
          Right Panel
          <br/>
          Turn goals(direction) into objectives(path w/ measurable criteria)
        </div> */}
      {/* </div> */}
    </div>
  </>)
}

export default Simple;