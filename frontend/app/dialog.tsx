'use client';
import {useEffect, useRef} from 'react';

export default function Dialog({label, onClose, busy=false, children}:{label:string; onClose:()=>void; busy?:boolean; children:React.ReactNode}) {
  const dialog=useRef<HTMLDivElement>(null);
  const close=useRef(onClose);close.current=onClose;
  const blocked=useRef(busy);blocked.current=busy;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const root=dialog.current;
    const focusable=()=>Array.from(root?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex="0"]')??[]);
    (focusable()[0]??root)?.focus();
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();if(!blocked.current)close.current();}
      if(event.key==='Tab'){
        const elements=focusable();const first=elements[0],last=elements.at(-1);
        if(!first){event.preventDefault();root?.focus();return;}
        if(event.shiftKey&&(document.activeElement===first||document.activeElement===root)){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&(document.activeElement===last||!root?.contains(document.activeElement))){event.preventDefault();first.focus();}
      }
    };
    document.addEventListener('keydown',key);
    return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus();};
  },[]);
  return <div className="modal-backdrop" onClick={()=>{if(!busy)onClose();}}><div className="modal" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={dialog} onClick={event=>event.stopPropagation()}>{children}</div></div>;
}
