import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom'; // redirect the user
import { useSelector, useDispatch } from 'react-redux'; // access state variables
import DataInput from '../../../components/Simple/DataInput/DataInput.jsx';
import DataResult from '../../../components/Simple/DataResult/DataResult.jsx';
import Header from '../../../components/Header/Header.jsx';
import Footer from "../../../components/Footer/Footer.jsx";
import { toast } from 'react-toastify'; // visible error notifications
import { logout, getData, getPublicData, resetDataSlice } from '../../../features/data/dataSlice.js';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import './Plans.css';

function Plans() {
  const [showNewData, setShowNewData] = useState(false);
  const [showMyPlans, setShowMyPlans] = useState(false);
  const [showPublicPlans, setShowPublicPlans] = useState(true);
  const [myPlans, setMyPlans] = useState([]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [publicPlans, setPublicPlans] = useState([]);
  const [sortOrder, setSortOrder] = useState('createdate-desc');
  const [date, setDate] = useState(new Date());
  const [meetings] = useState({
    '2023-12-01': 2,
    '2023-12-05': 1,
    '2023-12-10': 3,
  });
  const [showRichActionAnalysis, setShowRichActionAnalysis] = useState(false);
  const [richActionData, setRichActionData] = useState([]);
  const [richActionAnalysis, setRichActionAnalysis] = useState(null);
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const rootStyle = window.getComputedStyle(document.body);
  const toastDuration = parseInt(rootStyle.getPropertyValue('--toast-duration'), 10);
  const loadingStartTime = useRef(null);

  const { user, data, dataIsLoading, dataIsSuccess, dataIsError, dataMessage } = useSelector(
    (state) => state.data
  );

  // called on state changes
  useEffect(() => {
    if (dataIsSuccess) {
      // toast.success('Successfully received plans.', { autoClose: toastDuration });
    }
    if (dataIsError) {
      if (dataMessage && (dataMessage.includes('TokenExpiredError') || dataMessage.includes('token') || dataMessage.includes('Not authorized'))) {
        // Handle token errors
      } else {
        toast.error(dataMessage, { autoClose: 8000 });
        console.error(dataMessage);
      }
    }
  }, [dataIsError, dataIsSuccess, dataMessage, dispatch, navigate, toastDuration, user]);

  useEffect(() => {
    if (dataIsLoading) {
      loadingStartTime.current = Date.now();
    } else if (loadingStartTime.current && Date.now() - loadingStartTime.current > 5000) {
      toast.info('The server service takes about a minute to spin up. Please try again in a moment.', {
        autoClose: 3000,
      });
    }
  }, [dataIsLoading]);

  useEffect(() => {
    let stopLoading = false;

    async function getMyData() {
      try {
        const searchStrings = ['|Plan:', '|Goal:', '|Action:'];
        for (const searchString of searchStrings) {
          if (stopLoading) break;
          await dispatch(getData({ data: { text: searchString } })).unwrap();
        }
      } catch (error) {
        if(error.includes('TokenExpiredError') || error.includes('Not authorized') || error.includes('User not found')) {
          dispatch(logout());
          navigate('/login');
        }
        console.error(error.message);
        toast.error(error.message);
        stopLoading = true;
      }
    }

    async function getThePublicData() {
      try {
        const searchStrings = ['|Plan:', '|Goal:', '|Action:'];
        for (const searchString of searchStrings) {
          if (stopLoading) break;
          await dispatch(getPublicData({ data: { text: searchString } })).unwrap();
        }
      } catch (error) {
        console.error(error.message);
        toast.error(error.message);
        stopLoading = true;
      }
    }

    if (user) {
      getMyData();
    } else {
      getThePublicData();
    }

    return () => {
      dispatch(resetDataSlice());
    };
  }, [dispatch, user, navigate]);
  
  useEffect(() => {
    function handleAllOutputData(PlanStringArray) {
      if (!PlanStringArray) {
        console.log('PlanStringArray is undefined');
        return;
      }

      const outputMyPlanArray = [];
      const outputPublicPlanArray = [];

      if (PlanStringArray.length === 0) {
        console.log('PlanStringArray is empty');
      } else {
        console.log('PlanStringArray content:', PlanStringArray); // Enhanced log
      }

      const processPlanArray = (itemIDData, itemCreatedAtData, itemUpdatedAtData, itemString, files, index, array, itemUser) => {
        array.push(
          <DataResult
            key={`${array === outputMyPlanArray ? 'MyDataResult' : 'PublicDataResult'}${index}${itemIDData}`}
            importPlanString={itemString}
            files={files}
            updatedAtData={itemUpdatedAtData}
            createdAtData={itemCreatedAtData}
            itemID={itemIDData}
            userName={itemUser.nickname ? itemUser.nickname : 'Unknown'}
            userBadge={itemUser.badge ? itemUser.badge : 'Unknown'}
          />
        );
      };

      PlanStringArray.forEach((itemarino, index) => {
        // The data content is directly in itemarino.data as a string
        let itemString = typeof itemarino.data === 'string' ? itemarino.data : 'Unknown';
        
        // Ensure createdAt, updatedAt, and _id are consistently accessed from the top-level itemarino
        const itemCreatedAt = itemarino.createdAt;
        const itemUpdatedAt = itemarino.updatedAt;
        const itemID = itemarino._id;

        if (!itemID) {
          console.warn('ItemID (_id) is missing for item:', itemarino);
          // Skip this item since itemID is crucial
          return;
        }
        
        if (itemString.length > 500) {
          itemString = itemString.substring(0, 500) + '...';
        }

        const files = itemarino.files || [];

        const creatorMatch = itemString.match(/Creator:(.*?)\|/);
        const itemUser = creatorMatch ? {
          id: creatorMatch[1],
          nickname: user && creatorMatch[1] === user._id ? user.nickname : `User${creatorMatch[1].slice(-4)}`,
          badge: creatorMatch[1].toString() === "6770a067c725cbceab958619" ? 'Gold' : 'Silver'
        } : { id: 'Unknown', nickname: 'Unknown', badge: 'Unknown' };
        // console.log(itemUser);
        if (typeof itemString === 'string') {
          if (user && itemString.includes(user._id)) processPlanArray(itemID, itemCreatedAt, itemUpdatedAt, itemString, files, index, outputMyPlanArray, itemUser);
          if (itemString.includes('|Public:true')) processPlanArray(itemID, itemCreatedAt, itemUpdatedAt, itemString, files, index, outputPublicPlanArray, itemUser);
        }
      });

      const sortPlans = (plans) => {
        return [...plans].sort((a, b) => {
          switch (sortOrder) {
            case 'itemstring-asc':
              return a.props.importPlanString.localeCompare(b.props.importPlanString);
            case 'itemstring-desc':
              return b.props.importPlanString.localeCompare(a.props.importPlanString);
            case 'createdate-asc':
              return new Date(a.props.createdAtData) - new Date(b.props.createdAtData);
            case 'createdate-desc':
              return new Date(b.props.createdAtData) - new Date(a.props.createdAtData);
            default:
              return 0;
          }
        });
      };

      setMyPlans(sortPlans(outputMyPlanArray));
      setPublicPlans(sortPlans(outputPublicPlanArray));

      // Filter and analyze Rich Action Data
      const richActionItems = PlanStringArray.filter(item => {
        const itemString = typeof item.data === 'string' ? item.data : 'Unknown';
        return itemString.includes('RichActionData:true');
      });
      
      if (richActionItems.length > 0) {
        setRichActionData(richActionItems);
        const analysis = analyzeProductivityPatterns(richActionItems);
        setRichActionAnalysis(analysis);
      }
    }
    if (data.data) {
      handleAllOutputData(data.data);
    }
  }, [data, user, sortOrder]);

  function handleCreateDataToggle() {
    setShowNewData(!showNewData);
  }
  function handleMyPlansToggle() {
    setShowMyPlans(!showMyPlans);
  }
  function handlePublicPlansToggle() {
    setShowPublicPlans(!showPublicPlans);
  }
  function handleCalendarToggle() {
    setShowCalendar(!showCalendar);
  }
  function handleLogin() {
    dispatch(logout());
    navigate('/login');  
  }
  function handleRichActionAnalysisToggle() {
    setShowRichActionAnalysis(!showRichActionAnalysis);
    if (!showRichActionAnalysis && richActionData.length === 0) {
      // Load Rich Action Data when first opened
      loadRichActionData();
    }
  }

  // Load and analyze Rich Action Data
  const loadRichActionData = async () => {
    try {
      // Search for items marked as RichActionData
      await dispatch(getData({ data: { text: 'RichActionData:true' } })).unwrap();
    } catch (error) {
      console.error('Error loading rich action data:', error);
      toast.error('Failed to load rich action data');
    }
  };

  // Analyze productivity patterns
  const analyzeProductivityPatterns = (items) => {
    const analysis = {
      totalItems: items.length,
      weeklyBreakdown: {},
      productivityClassification: {
        highly_productive: 0,
        moderately_productive: 0,
        non_productive: 0
      },
      timeTracking: {
        totalHours: 0,
        averageHoursPerDay: 0,
        peakProductivityHours: {}
      }
    };

    // Keywords for productivity classification
    const highlyProductiveKeywords = [
      'coding', 'development', 'programming', 'building', 'creating', 
      'designing', 'implementing', 'solving', 'debugging', 'optimizing',
      'planning launch', 'strategy', 'analysis', 'review', 'research'
    ];
    
    const nonProductiveKeywords = [
      'general talking', 'chatting', 'break', 'lunch', 'waiting',
      'idle', 'browsing', 'distracted', 'interruption', 'social media'
    ];

    items.forEach(item => {
      const itemText = (item.data || item.text || '').toLowerCase();
      const createdAt = new Date(item.createdAt);
      const weekKey = `${createdAt.getFullYear()}-W${Math.ceil(createdAt.getDate() / 7)}`;

      // Weekly breakdown
      if (!analysis.weeklyBreakdown[weekKey]) {
        analysis.weeklyBreakdown[weekKey] = { items: 0, hours: 0 };
      }
      analysis.weeklyBreakdown[weekKey].items++;

      // Productivity classification
      let classified = false;
      for (const keyword of highlyProductiveKeywords) {
        if (itemText.includes(keyword)) {
          analysis.productivityClassification.highly_productive++;
          classified = true;
          break;
        }
      }
      
      if (!classified) {
        for (const keyword of nonProductiveKeywords) {
          if (itemText.includes(keyword)) {
            analysis.productivityClassification.non_productive++;
            classified = true;
            break;
          }
        }
      }
      
      if (!classified) {
        analysis.productivityClassification.moderately_productive++;
      }

      // Extract time information (basic pattern matching)
      const timeMatches = itemText.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/gi);
      if (timeMatches && timeMatches.length >= 2) {
        // Assume time range and calculate hours (simplified)
        analysis.timeTracking.totalHours += 1; // Placeholder calculation
        analysis.weeklyBreakdown[weekKey].hours += 1;
      }
    });

    // Calculate averages
    const totalWeeks = Object.keys(analysis.weeklyBreakdown).length;
    if (totalWeeks > 0) {
      analysis.timeTracking.averageHoursPerDay = analysis.timeTracking.totalHours / (totalWeeks * 7);
    }

    return analysis;
  };

  return (
    <>
      <Header />
      <div className='planit-plans'>
        Plans
        <div className='planit-plans-text'>Every journey begins with a step.</div>
        {user && 
          <div className='planit-plans-create'>
            <div onClick={handleCreateDataToggle} className='planit-plans-create-text'>
              {showNewData ? 'Cancel Plan' : 'Create Plan'}
            </div>
              <div className='planit-plans-in'>
                {showNewData && <DataInput />}
              </div>
          </div>
        }

        {!user && 
          <div className='planit-plans-create'>
            <div onClick={handleLogin} className='planit-plans-create-text'>
              Log in to create a post
            </div>
          </div>
        }

        <div className='planit-plans-calendar'>
          <div onClick={handleCalendarToggle} className='planit-plans-calendar-text'>
            Calendar
          </div>          
          {showCalendar && (
            <div>
              <div className='planit-plans-calendar-out'>
                <Calendar
                  onChange={setDate}
                  value={date}
                  tileContent={({ date, view }) => {
                    const dateString = date.toISOString().split('T')[0];
                    const meetingCount = meetings[dateString] || 0;
                    return (
                      <div className="planit-plans-calendar-out-tile-content">
                        <div className="planit-plans-calendar-out-meeting-count">
                          {meetingCount > 0 ? meetingCount : ''}
                        </div>
                      </div>
                    );
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {user && <div className='planit-plans-my'>
          <div onClick={handleMyPlansToggle} className='planit-plans-my-text'>
            My Plans
          </div>
          {showMyPlans && (
            <div className='planit-plans-my-out'>
                      
              <div className='planit-plans-my-out-sort'>
                <label htmlFor='sortOrder'>Sort by: </label>
                <select
                  id='sortOrder'
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                >
                  <option value='itemstring-asc'>Item String Ascending</option>
                  <option value='itemstring-desc'>Item String Descending</option>
                  <option value='createdate-asc'>Create Date Ascending</option>
                  <option value='createdate-desc'>Create Date Descending</option>
                </select>
              </div>

              {myPlans.length > 0 ? (
                <div className='planit-plans-my-out-result'>{myPlans}</div>
              ) : (
                <h3>You have not set any plans</h3>
              )}
            </div>
          )}
        </div>}

        {user && richActionData.length > 0 && <div className='planit-plans-rich-action'>
          <div onClick={handleRichActionAnalysisToggle} className='planit-plans-rich-action-text'>
            Rich Action Data Analysis ({richActionData.length} items)
          </div>
          {showRichActionAnalysis && (
            <div className='planit-plans-rich-action-out'>
              
              {richActionAnalysis && (
                <div className='planit-plans-rich-action-analysis'>
                  <div className='planit-plans-rich-action-summary'>
                    <h3>📊 Productivity Overview</h3>
                    
                    <div className='planit-plans-rich-action-metrics'>
                      <div className='planit-plans-rich-action-metric'>
                        <span className='metric-label'>Total Items:</span>
                        <span className='metric-value'>{richActionAnalysis.totalItems}</span>
                      </div>
                      
                      <div className='planit-plans-rich-action-metric'>
                        <span className='metric-label'>Total Hours Tracked:</span>
                        <span className='metric-value'>{richActionAnalysis.timeTracking.totalHours.toFixed(1)}</span>
                      </div>
                      
                      <div className='planit-plans-rich-action-metric'>
                        <span className='metric-label'>Avg Hours/Day:</span>
                        <span className='metric-value'>{richActionAnalysis.timeTracking.averageHoursPerDay.toFixed(1)}</span>
                      </div>
                    </div>

                    <div className='planit-plans-rich-action-productivity'>
                      <h4>🎯 Productivity Classification</h4>
                      <div className='productivity-bars'>
                        <div className='productivity-bar highly-productive'>
                          <span className='bar-label'>Highly Productive</span>
                          <div className='bar-container'>
                            <div className='bar-fill' style={{width: `${(richActionAnalysis.productivityClassification.highly_productive / richActionAnalysis.totalItems) * 100}%`}}></div>
                          </div>
                          <span className='bar-count'>{richActionAnalysis.productivityClassification.highly_productive}</span>
                        </div>
                        
                        <div className='productivity-bar moderately-productive'>
                          <span className='bar-label'>Moderately Productive</span>
                          <div className='bar-container'>
                            <div className='bar-fill' style={{width: `${(richActionAnalysis.productivityClassification.moderately_productive / richActionAnalysis.totalItems) * 100}%`}}></div>
                          </div>
                          <span className='bar-count'>{richActionAnalysis.productivityClassification.moderately_productive}</span>
                        </div>
                        
                        <div className='productivity-bar non-productive'>
                          <span className='bar-label'>Non-Productive</span>
                          <div className='bar-container'>
                            <div className='bar-fill' style={{width: `${(richActionAnalysis.productivityClassification.non_productive / richActionAnalysis.totalItems) * 100}%`}}></div>
                          </div>
                          <span className='bar-count'>{richActionAnalysis.productivityClassification.non_productive}</span>
                        </div>
                      </div>
                    </div>

                    <div className='planit-plans-rich-action-weekly'>
                      <h4>📅 Weekly Breakdown</h4>
                      <div className='weekly-data'>
                        {Object.entries(richActionAnalysis.weeklyBreakdown).map(([week, data]) => (
                          <div key={week} className='week-item'>
                            <span className='week-label'>{week}:</span>
                            <span className='week-items'>{data.items} items</span>
                            <span className='week-hours'>{data.hours}h tracked</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className='planit-plans-rich-action-items'>
                    <h4>📋 Recent Rich Action Items</h4>
                    <div className='rich-action-items-list'>
                      {richActionData.slice(0, 5).map((item, index) => {
                        const itemString = typeof item.data === 'string' ? item.data : 'Unknown';
                        const truncatedString = itemString.length > 200 ? itemString.substring(0, 200) + '...' : itemString;
                        
                        return (
                          <div key={item._id || index} className='rich-action-item'>
                            <div className='rich-action-item-text'>{truncatedString}</div>
                            <div className='rich-action-item-date'>
                              {new Date(item.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              
              {!richActionAnalysis && (
                <div className='planit-plans-rich-action-loading'>
                  <p>Analyzing productivity patterns...</p>
                </div>
              )}
              
            </div>
          )}
        </div>}

        <div className='planit-plans-saved'>
          <div onClick={handlePublicPlansToggle} className='planit-plans-saved-text'>
            Public Plans
          </div>
          {showPublicPlans && (
            <div className='planit-plans-saved-out'>

            <div className='planit-plans-my-out-sort'>
                <label htmlFor='sortOrder'>Sort by: </label>
                <select
                  id='sortOrder'
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                >
                  <option value='itemstring-asc'>Item String Ascending</option>
                  <option value='itemstring-desc'>Item String Descending</option>
                  <option value='createdate-asc'>Create Date Ascending</option>
                  <option value='createdate-desc'>Create Date Descending</option>
                </select>
              </div>

              {publicPlans.length > 0 ? (
                <div className='planit-plans-saved-out-result'>{publicPlans}</div>
              ) : (
                <h3>Please wait about a minute for the backend to startup.</h3>
              )}
            </div>
          )}
        </div>
      </div>
      <Footer />
    </>
  );
}

export default Plans;