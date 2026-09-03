import { useEffect, useRef } from "react";

function useOutsideAlerter( alertType, insideComponentRef, toggleButtonRef, ComponentVisibility , setComponentVisibility ){  
    const clickNumRef = useRef(0);
    const dropperNumRef = useRef(0);
    // RUNS TWICE ON STARTUP
    useEffect(() => {
      // RUNS ON EVERY CLICK && RUNS ON EACH TOGGLE  => RUNS TWICE ON TOGGLE
      function handleOutsideClick(event){
        const toggleEl = toggleButtonRef.current;
        const insideEl = insideComponentRef.current;
        const target = event.target;

        // The refs can be null while the component is (un)mounting or when the
        // toggle/container elements aren't rendered — bail out rather than throw.
        if (!toggleEl || !insideEl || !target) return;

        // if dropper button pressed && dropper was closed
        if((toggleEl.contains(target)) && !ComponentVisibility()){
          dropperNumRef.current = 1;
          clickNumRef.current = 0;
        }else if((alertType === "share") && (dropperNumRef.current === 0)){
          dropperNumRef.current=1;
          clickNumRef.current++;
        // else if dropper button pressed && dropper was open
        }else if((toggleEl.contains(target)) && ComponentVisibility()){
          dropperNumRef.current=0;
        // else if outside space was clicked && dropper button wasnt pressed
        }else if((!insideEl.contains(target)) && (!toggleEl.contains(target))){
          // if dropper is open
          if(dropperNumRef.current===1){

            // If (outside space was clicked && dropper button wasnt pressed) && droper was just opened
            if(clickNumRef.current===0){
              clickNumRef.current++;
            // If (outside space was clicked && dropper button wasnt pressed) && droper has been open
            }else{
              setComponentVisibility();
              clickNumRef.current=0;
              dropperNumRef.current=0;
            }
          }
        }
      }
      function handleScroll(event){
        if(dropperNumRef.current === 1){
          dropperNumRef.current=0;
          setComponentVisibility();
        }

      }
      document.addEventListener('scroll', handleScroll);
      document.addEventListener('click', handleOutsideClick);
      return () => {
        document.removeEventListener('scroll', handleScroll);
        document.removeEventListener('click', handleOutsideClick); 
      }
    }, [alertType, insideComponentRef, toggleButtonRef, ComponentVisibility, setComponentVisibility])
}

export default useOutsideAlerter