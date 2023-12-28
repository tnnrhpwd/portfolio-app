import { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux'      // useDispatch-brings in reset,register,login from state
import { createData, deleteData } from '../../features/datas/dataSlice'
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en.json'
import './PlanPreview.css';

function PlanPreview(props) {
    const [ comment, setComment ] = useState("")
    const [ commentComponentArray, setCommentComponentArray ] = useState("")
    const [ commentTime, setCommentTime ] = useState('')
    var user = false;
    if (props.user){
        user = props.user;
    }

    const dispatch = useDispatch();  // initialization



    const offsetMultiplier = 1.5;
    const plan = props.planIdentity;
    const yOffset = props.screenY * offsetMultiplier + 50;

    const importedComments = props.planIDComments;

    useEffect(() => {
 



        

        function getTimeSince(timeWas){
            TimeAgo.addDefaultLocale(en)
            // const timeAgo = new TimeAgo('en-US')

            // var timeSince = timeAgo.format( 
            //     Date.now() 
            //     - Date.parse(
            //         timeWas.split('T')[0].split('-')[0] + " " 
            //         + timeWas.split('T')[1].split('.')[0] + " GMT"
            //     ) 
            //     + 52 * 31536000730 + 1209600000
            // )
            var answer = ' Created: '+ timeWas.split('T')[0] //+ " ("+timeSince+")" //+ Date.now().strftime('The date is %b %d, %Y')

            return (answer)
        }

        setCommentTime(getTimeSince(plan.createdAt))


        function handleOutputComments(){
            var outputArray = [];
            importedComments.forEach(( selComment, commentIndex ) => {
                if(selComment.plan === plan._id){

                    function handleDeleteComment(){
                        dispatch(deleteData(selComment._id))
                        console.log("delete "+selComment._id)
                    }
    
                    if(selComment.comment) {
                        outputArray.push(<>
                            <div key={selComment._id} className='planpreview-window-comments-result'>
    
                                <div key={selComment._id+"1"} className='planpreview-window-comments-result-comment'>{selComment.comment}</div>
                                <div key={selComment._id+"2"} className='planpreview-window-comments-result-time'>{getTimeSince(selComment.createdAt)}</div>
                                { (user) ? 
                                    <>
                                        { (user._id === selComment.user) &&
                                            <button onClick={handleDeleteComment} key={selComment._id+"0"} className='planpreview-window-comments-result-delete'>Delete Comment</button>
                                        }
                                    </>:null
                                }
                            </div>
                        </>)
                    }
                }

            });
            setCommentComponentArray(outputArray)
        }

        handleOutputComments()
    }, [comment._id, comment.user, dispatch, importedComments, plan._id, plan.createdAt, plan.updatedAt, user])
    




    const onSubmit = (e) => {
        e.preventDefault()

        dispatch(createData({ plan, comment }))
        setComment('')                      // empty comment field
    }

    return (
        <div className='planpreview'>
            <div className='planpreview-window'
                style={{marginTop: yOffset}}
                >
                <div className='planpreview-window-close'>
                    <button onClick={props.handlePlanPreviewClose}>Close</button>
                </div>

                <div className='planpreview-window-goal'>
                    {plan.goal} {commentTime}
                </div>

                <div className='planpreview-window-plan'>
                    {plan.plan}
                </div>
                <form onSubmit={onSubmit}>
                    <div className='planpreview-window-addcomment'>
                        <textarea
                            type='plan'
                            name='plan'
                            className='planpreview-window-addcomment-input'
                            placeholder='Enter comment here.'
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}   // change text field value
                        />
                        <button className='planpreview-window-addcomment-submit' type='submit'>
                            Submit Comment ❤
                        </button>
                    </div>
                </form>
                <div className='planpreview-window-comments'>

                    {commentComponentArray}
                </div>
            </div>
        </div>
    )
}

export default PlanPreview