import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'              // page redirects
import { useSelector, useDispatch } from 'react-redux'      // access state variables
import { toast } from 'react-toastify'                        // visible error notifications
import { createData, deleteData, getData, resetDataSlice } from '../../../features/data/dataSlice'
import DeleteView from '../../../components/SimpleAction/DeleteView/DeleteView'
import Spinner from '../../../components/Spinner/Spinner';
import PlanResult from '../../../components/SimpleAction/PlanResult/PlanResult'
import './InfoPlan.css';

function InfoData() {
    const { id } = useParams();
    const dispatch = useDispatch();
    const [ chosenData, setChosenData ] = useState(null);
    const [ importedDatas, setImportedDatas ] = useState(null);
    const [ newData, setNewData ] = useState("");
    const [ dataObjectArray, setDataObjectArray ] = useState([]);
    const [ showDeleteDataConfirmation, setShowDeleteDataConfirmation ] = useState(false);

    const { user, data, dataIsLoading, dataIsError, dataMessage } = useSelector(     // select data values from data state
        (state) => state.data
    )

    const navigate = useNavigate() // initialization


    // called on state changes
    useEffect(() => {
        if ( dataIsError ) {

            toast.error(dataMessage) // print error to toast errors
        }

        dispatch(getData()) // dispatch connects to the store, then retreives the datas that match the logged in user.
  
        
        return () => {    // reset the datas when state changes
        dispatch(resetDataSlice()) // dispatch connects to the store, then reset state values( dataMessage, isloading, iserror, and issuccess )
        }
    }, [dataIsError, dataMessage, dispatch])


    useEffect(() => {
        function handleSelectData( IDString, dataObjectArray ){
            var outputDataComponentArray = [];
            const selectedData = dataObjectArray.find( x => x[0] === IDString )
            console.log(selectedData)
            setChosenData(selectedData)
            if( ( selectedData ) ){
                selectedData[4].forEach(( selData, selDataIndex ) => {
                    outputDataComponentArray.push(<PlanResult key={"PlanResult"+IDString+" "+selDataIndex} data={selData}/>)
                })
            }
            setImportedDatas( outputDataComponentArray );
        }
        handleSelectData( id, dataObjectArray )
    }, [id, dataObjectArray])


    // if(authIsLoading){
    //     return(<Spinner/>)
    // }

    const handleSubmitNewData = (e) => {
        e.preventDefault()

        if( newData === "" ){ toast.error("Please enter your data first.", { autoClose: 1000 }); return; } // No input text guard clause
        if( newData.length > 280 ){ toast.error("Please shorten your data to 280 characters.", { autoClose: 1000 }); return; } // Too long input text guard clause

        const topic = chosenData[0];
        const data = newData   

        dispatch(createData({ topic , data }))

        setNewData('')
        
        toast.success("Data Submitted!", { autoClose: 1000 }) // print error to toast errors
    }

    const handleDeleteData = () => {
        dispatch(deleteData( chosenData[0] ))
        toast.info("Your data has been deleted.", { autoClose: 2000 }) // print error to toast errors
        navigate('/datas')           // send user to dashboard

    }
    const handleShowDeleteData = (e) => {
        e.preventDefault()
        if(showDeleteDataConfirmation){setShowDeleteDataConfirmation(false)}
        else if(!showDeleteDataConfirmation){setShowDeleteDataConfirmation(true)}
    }

    if(chosenData){
        return (
            <div className="infodata">
                <div className='infodata-delete'>
                    { (user) &&
                        <>{ ( user._id === chosenData[1]) &&
                            <button 
                                className = 'infodata-delete-button'
                                onClick = {handleShowDeleteData}
                                >
                                Delete Data
                            </button>
                        }</>
                    }
                </div> 
                {   ( showDeleteDataConfirmation ) &&
                    < DeleteView view={true} delFunction={handleDeleteData} click={setShowDeleteDataConfirmation} type="data" id={chosenData[0]}/>
                }
                <div className='infodata-data'>
                    <div className='infodata-data-text'>
                        <a href = { '/data/' + chosenData[2][0] }>
                            <button 
                                key = { "data-text-" + chosenData[2][0] } 
                                className = 'infodata-data-text-data'
                                >
                                { chosenData[2][1] }
                            </button>
                        </a> 



                    </div>
                </div>                 
                <div className='infodata-data'>
                    <div className='infodata-data-text'>
                        { chosenData[3].map(( data, dataIndex ) => {
                            return (
                            <a href = { '/data/' + data[0] } key = { "data-text-"+data[0]+ " " + dataIndex } >
                                <button 
                                    key = { "data-text-" + dataIndex } 
                                    className = 'infodata-data-text-data'
                                    >
                                    { data[1] }
                                </button>
                            </a>
                            )
                        }) }
                    </div>
                </div> 
                <div className='infodata-newdata'>
                    <textarea 
                        value={newData}
                        name='data'
                        placeholder='Enter data here.'
                        onChange={(e) => setNewData(e.target.value)}   // change text field value
                        className='infodata-newdata-textarea'
                    />
                    <button className='infodata-newdata-submit' onClick={handleSubmitNewData}>
                        Submit
                    </button>
                </div>
                <div className='infodata-datas'>
                    { importedDatas } 
                </div>
            </div>
        )
    }else{
        return(<Spinner/>)
    }

}

export default InfoData