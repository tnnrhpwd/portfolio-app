import CreatedAt from "../PlanResult/CreatedAt"
import './CommentResult.css';

function CommentResult(props) {
    if(props.comment){
        return (
            <div className='commentresult'>
                <div className='commentresult-time'>
                    <CreatedAt createdAt={props.comment[3]}/>
                </div>
                <div className='commentresult-comment'>
                    {props.comment[1]}
                </div>

            </div>
        )
    }

}

export default CommentResult