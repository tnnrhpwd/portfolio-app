import './ActionResult.css';

function ActionResult(props) {
  return (<>
    <div className='actionresult'>
      {props.selAction}
    </div>
  </>)
}

export default ActionResult