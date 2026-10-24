'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,ArrowRight,Check,Compass,FlaskConical,Layers3,Play,X} from 'lucide-react';
import './walkthrough.css';
import {LOGIN_DEMO_KEY} from './demo-onboarding';
import {tourSteps,tourTabs,type TourTab} from './walkthrough-steps';
export {tourSteps} from './walkthrough-steps';

export const TOUR_STORAGE_KEY='brandforge-walkthrough-v2';
type Rect={x:number;y:number;width:number;height:number};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(value,Math.max(min,max)));

export default function Walkthrough({request,activeTab,onComplete,autoWelcome=true}:{request:number;activeTab:string;onComplete:()=>Promise<boolean>;autoWelcome?:boolean}) {
  const [mode,setMode]=useState<'closed'|'welcome'|'steps'>('closed');
  const [index,setIndex]=useState(0),[rect,setRect]=useState<Rect|null>(null);
  const [viewport,setViewport]=useState({width:1024,height:768}),[cardHeight,setCardHeight]=useState(300);
  const card=useRef<HTMLDivElement>(null),lastRequest=useRef(request),previousFocus=useRef<HTMLElement|null>(null);
  const [clickedGate,setClickedGate]=useState<{index:number;tab:TourTab}|null>(null);
  const [finishing,setFinishing]=useState(false),[finishError,setFinishError]=useState('');
  const finishingRef=useRef(false);
  const maskId=useId().replaceAll(':','');
  const step=tourSteps[index];
  const awaitingNavigation=mode==='steps'&&(step.action==='navigate'||activeTab!==step.tab);
  const targetId=awaitingNavigation?tourTabs[step.tab]:step.target;
  const tabLabel=step.tab==='Guidelines'?'Guidelines & rules':step.tab;
  const advance=async()=>{
    if(awaitingNavigation||finishingRef.current)return;
    if(index!==tourSteps.length-1){setClickedGate(null);setIndex(value=>value+1);return;}
    finishingRef.current=true;setFinishing(true);setFinishError('');
    try{if(await onComplete())close(true);else setFinishError('The judge demo could not start. Check the workspace connection and try again.');}
    catch{setFinishError('The judge demo could not start. Check the workspace connection and try again.');}
    finally{finishingRef.current=false;setFinishing(false);}
  };
  const previous=()=>{if(finishingRef.current)return;setClickedGate(null);setFinishError('');setIndex(value=>Math.max(0,value-1));};
  useEffect(()=>{
    if(mode!=='steps'||!clickedGate||clickedGate.index!==index||activeTab!==step.tab)return;
    setClickedGate(null);
    if(step.action==='navigate')setIndex(value=>Math.min(tourSteps.length-1,value+1));
  },[mode,clickedGate,index,activeTab,step]);
  useEffect(()=>{
    if(mode==='closed')return;
    const guard=(event:MouseEvent)=>{
      const clicked=event.target as Node|null;if(!clicked||card.current?.contains(clicked))return;
      const target=awaitingNavigation?document.querySelector<HTMLElement>(`[data-tour="${targetId}"]`):null;
      if(target?.contains(clicked)&&!(target as HTMLButtonElement).disabled){setClickedGate({index,tab:step.tab});return;}
      event.preventDefault();event.stopImmediatePropagation();
    };
    document.addEventListener('click',guard,true);
    return()=>document.removeEventListener('click',guard,true);
  },[mode,index,awaitingNavigation,targetId,step]);
  const close=(completed=false)=>{if(finishingRef.current&&!completed)return;try{localStorage.setItem(TOUR_STORAGE_KEY,completed?'completed':'skipped');}catch{}setClickedGate(null);setMode('closed');};
  useEffect(()=>{if(!autoWelcome)return;let freshLogin=false;try{freshLogin=sessionStorage.getItem(LOGIN_DEMO_KEY)==='pending';if(freshLogin)sessionStorage.removeItem(LOGIN_DEMO_KEY);}catch{}try{if(freshLogin||!localStorage.getItem(TOUR_STORAGE_KEY))setMode('welcome');}catch{setMode('welcome');}},[]);
  useEffect(()=>{if(request!==lastRequest.current){lastRequest.current=request;setIndex(0);setMode('welcome');}},[request]);
  useEffect(()=>{
    if(mode==='closed')return;
    previousFocus.current=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=overflow;const previous=previousFocus.current;if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[mode==='closed']);
  useEffect(()=>{
    if(mode==='closed')return;
    const frame=requestAnimationFrame(()=>{
      // Do not steal focus if the visitor already selected a control before this frame.
      if(card.current?.contains(document.activeElement)&&document.activeElement!==card.current)return;
      const target=awaitingNavigation?document.querySelector<HTMLElement>(`[data-tour="${targetId}"]`):null;
      (target??card.current)?.focus({preventScroll:true});
    });
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();close();}
      if(event.key==='ArrowRight'&&mode==='steps'){event.preventDefault();event.stopImmediatePropagation();advance();}
      if(event.key==='ArrowLeft'&&mode==='steps'){event.preventDefault();event.stopImmediatePropagation();previous();}
      if(event.key==='Tab'){
        const target=awaitingNavigation?document.querySelector<HTMLButtonElement>(`[data-tour="${targetId}"]`):null;
        const buttons=[...(target&&!target.disabled?[target]:[]),...Array.from(card.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[])];
        if(!buttons.length)return;
        event.preventDefault();event.stopImmediatePropagation();
        const current=buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(current+(event.shiftKey?-1:1)+buttons.length)%buttons.length].focus({preventScroll:true});
      }
    };
    document.addEventListener('keydown',key,true);
    return()=>{cancelAnimationFrame(frame);document.removeEventListener('keydown',key,true);};
  },[mode,index,awaitingNavigation,targetId]);
  useEffect(()=>{
    if(mode==='closed')return;
    const update=()=>{setViewport({width:window.innerWidth,height:window.innerHeight});if(card.current)setCardHeight(card.current.getBoundingClientRect().height||300);};
    update();window.addEventListener('resize',update);
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(update):null;
    if(card.current)observer?.observe(card.current);
    return()=>{window.removeEventListener('resize',update);observer?.disconnect();};
  },[mode,index]);
  useEffect(()=>{
    if(mode!=='steps')return;
    let frame=0,attempts=0,element:HTMLElement|null=null;
    const measure=()=>{
      if(!element)return;
      const box=element.getBoundingClientRect();
      if(!box.width||!box.height)return;
      const x=Math.max(4,box.left-8),y=Math.max(4,box.top-8);
      const right=Math.min(window.innerWidth-4,box.right+8),bottom=Math.min(window.innerHeight-4,box.bottom+8);
      setRect(right>x&&bottom>y?{x,y,width:right-x,height:bottom-y}:null);
    };
    const locate=()=>{
      element=document.querySelector<HTMLElement>(`[data-tour="${targetId}"]`);
      if(!element&&!awaitingNavigation&&step.fallback)element=document.querySelector<HTMLElement>(`[data-tour="${step.fallback}"]`);
      if(!element){if(attempts++<45)frame=requestAnimationFrame(locate);else setRect(null);return;}
      element.scrollIntoView?.({block:element.getBoundingClientRect().height>window.innerHeight*0.55?'start':'center',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
      measure();
    };
    frame=requestAnimationFrame(locate);window.addEventListener('scroll',measure,true);window.addEventListener('resize',measure);
    const timer=window.setTimeout(measure,600);
    return()=>{cancelAnimationFrame(frame);clearTimeout(timer);window.removeEventListener('scroll',measure,true);window.removeEventListener('resize',measure);};
  },[mode,index,step,awaitingNavigation,targetId]);
  if(mode==='closed')return null;
  const besideTarget=rect?viewport.width-rect.x-rect.width-32:0;
  const width=Math.min(430,viewport.width-32,awaitingNavigation&&besideTarget>=220?besideTarget:430);
  let x=(viewport.width-width)/2,y=Math.max(16,(viewport.height-cardHeight)/2);
  if(rect){
    const options=[{x:rect.x+rect.width+18,y:rect.y},{x:rect.x-width-18,y:rect.y},{x:rect.x+rect.width/2-width/2,y:rect.y+rect.height+18},{x:rect.x+rect.width/2-width/2,y:rect.y-cardHeight-18}];
    const positioned=options.map(position=>{
      const x=clamp(position.x,16,viewport.width-width-16),y=clamp(position.y,16,viewport.height-cardHeight-16);
      const overlap=Math.max(0,Math.min(x+width,rect.x+rect.width)-Math.max(x,rect.x))*Math.max(0,Math.min(y+cardHeight,rect.y+rect.height)-Math.max(y,rect.y));
      return {x,y,score:overlap*100+Math.abs(x-position.x)+Math.abs(y-position.y)};
    }).sort((a,b)=>a.score-b.score);
    x=positioned[0].x;y=positioned[0].y;
  }
  const shields=rect&&mode==='steps'?[
    {left:0,top:0,width:viewport.width,height:rect.y},
    {left:0,top:rect.y,width:rect.x,height:rect.height},
    {left:rect.x+rect.width,top:rect.y,width:Math.max(0,viewport.width-rect.x-rect.width),height:rect.height},
    {left:0,top:rect.y+rect.height,width:viewport.width,height:Math.max(0,viewport.height-rect.y-rect.height)},
    ...(!awaitingNavigation?[{left:rect.x,top:rect.y,width:rect.width,height:rect.height}]:[]),
  ]:[{left:0,top:0,width:viewport.width,height:viewport.height}];
  return createPortal(<div className={`walkthrough-layer ${mode==='welcome'?'walkthrough-welcome':''}`}>
    {shields.map((shield,key)=><div key={key} className="walkthrough-shield" aria-hidden="true" style={shield}/>)}
    <svg className="walkthrough-dimmer" width="100%" height="100%" aria-hidden="true"><defs><mask id={maskId}><rect width="100%" height="100%" fill="white"/>{mode==='steps'&&rect&&<rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="15" fill="black"/>}</mask></defs><rect width="100%" height="100%" fill="#0b1814" fillOpacity=".77" mask={`url(#${maskId})`}/></svg>
    {mode==='steps'&&rect&&<div className="walkthrough-spotlight" data-testid="tour-spotlight" style={{transform:`translate(${rect.x}px,${rect.y}px)`,width:rect.width,height:rect.height}}/>}
    <div ref={card} tabIndex={-1} role="dialog" aria-modal={!awaitingNavigation} aria-labelledby="tour-title" aria-describedby="tour-body" className={`walkthrough-card ${mode==='welcome'?'is-welcome':''}`} style={{width,left:x,top:y}}>
      <button className="tour-close" aria-label="Skip walkthrough" disabled={finishing} onClick={()=>close()}><X size={18}/></button>
      {mode==='welcome'?<><div className="tour-welcome-art" aria-hidden="true"><span className="tour-art-orbit"/><span className="tour-art-orbit second"/><span className="tour-art-core"><Layers3 size={32}/></span><span className="tour-art-spark"><Compass size={17}/></span><span className="tour-art-check"><Check size={14}/></span></div><span className="tour-eyebrow">WELCOME TO BRANDFORGE</span><h2 id="tour-title">Set up your brand.<br/><em>Check your content.</em></h2><p id="tour-body">Learn how to add rules in BrandDNA, check content in BrandTwin, and submit a draft for approval. You click each highlighted tab. We’ll explain the controls as you go.</p><div className="tour-welcome-meta"><span><Play size={12}/>About 5 minutes</span><span>{tourSteps.length} steps</span><span>Skip any time</span></div><div className="tour-demo-note"><FlaskConical size={15}/><span><strong>Here for the hackathon?</strong> The demo includes a separate workspace, six rules, and two sample posters. These predefined fixtures are for testing; real checks still run on your content.</span></div><button className="tour-primary" onClick={()=>{setIndex(0);setClickedGate(null);setMode('steps');}}>Show me around<ArrowRight size={16}/></button><button className="tour-skip-welcome" onClick={()=>close()}>I’ll explore on my own</button><p className="tour-replay-hint">For judges and everyday users. Replay from “Start walkthrough.”</p></>:<><div className="tour-step-label"><span>{step.chapter}</span><span>{String(index+1).padStart(2,'0')} / {tourSteps.length}</span></div><div className="tour-progress tour-progress-track" aria-label={`Step ${index+1} of ${tourSteps.length}`}><i style={{width:`${(index+1)/tourSteps.length*100}%`}}/></div><h2 id="tour-title">{awaitingNavigation&&step.action!=='navigate'?`Return to ${tabLabel}.`:step.title}</h2><p id="tour-body">{awaitingNavigation&&step.action!=='navigate'?`Click the highlighted ${tabLabel} tab to revisit this part of the walkthrough. The tour will wait for your click.`:step.body}</p>{awaitingNavigation&&<div className="tour-click-instruction" role="status"><span className="tour-click-pulse"/>Your turn: click {tabLabel} in the sidebar.</div>}{finishError&&<div className="tour-finish-error" role="alert">{finishError}</div>}<div className="tour-step-footer"><button className="tour-skip" disabled={finishing} onClick={()=>close()}>Skip tour</button><div><button className="tour-back" disabled={!index||finishing} aria-label="Previous step" onClick={previous}><ArrowLeft size={15}/></button><button className="tour-primary" disabled={awaitingNavigation||finishing} onClick={advance}>{finishing?'Preparing demo...':index===tourSteps.length-1?'Start judge demo':'Next'}{index===tourSteps.length-1?<Check size={15}/>:<ArrowRight size={15}/>}</button></div></div><span className="tour-keyboard-hint">Next for explanations · Click highlighted tabs to open them · Esc to skip</span></>}
    </div>
  </div>,document.body);
}
