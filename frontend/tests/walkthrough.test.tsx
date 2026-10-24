import React,{useState} from 'react';
import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,expect,it,vi} from 'vitest';
import Walkthrough,{TOUR_STORAGE_KEY,tourSteps} from '../app/walkthrough';
import DemoKit from '../app/demo-kit';
import {tourTabs,type TourTab} from '../app/walkthrough-steps';

beforeEach(()=>{
  localStorage.clear();vi.restoreAllMocks();
  HTMLElement.prototype.scrollIntoView=vi.fn();
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    return {x:40,y:100,left:40,top:100,right:520,bottom:220,width:480,height:120,toJSON:()=>({})} as DOMRect;
  });
});
function Harness({initialTab='Overview',onVisit=()=>{},onComplete=async()=>true}:{initialTab?:string;onVisit?:(tab:string)=>void;onComplete?:()=>Promise<boolean>}){
  const [tab,setTab]=useState(initialTab),[request,setRequest]=useState(0);
  const targets=Array.from(new Set(tourSteps.filter(step=>step.tab===tab&&step.action!=='navigate').map(step=>step.target)));
  return <><button onClick={()=>setRequest(value=>value+1)}>Replay tour</button><nav>{Object.entries(tourTabs).map(([name,target])=><button key={name} data-tour={target} onClick={()=>{onVisit(name);setTab(name);}}>{name}</button>)}</nav><span data-testid="tab">{tab}</span>{targets.map(target=><div key={target} data-tour={target}>{target}</div>)}<Walkthrough request={request} activeTab={tab} onComplete={onComplete}/></>;
}
async function begin(){await userEvent.click(await screen.findByRole('button',{name:'Show me around'}));}
async function reach(title:string){
  for(const step of tourSteps){
    if(step.title===title)return;
    if(step.action==='navigate')await userEvent.click(screen.getByRole('button',{name:step.tab}));
    else await userEvent.click(screen.getByRole('button',{name:'Next'}));
  }
  throw new Error('Unknown tour heading: '+title);
}
it('welcomes first-time users and discloses predefined fixtures',async()=>{
  render(<Harness/>);const dialog=await screen.findByRole('dialog');
  expect(within(dialog).getByText(/Here for the hackathon/)).toBeInTheDocument();
  expect(within(dialog).getByText(/predefined fixtures are for testing/)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Show me around'})).toBeInTheDocument();
});
it('skips, remembers that choice, and restores page scrolling',async()=>{
  const app=render(<Harness/>);await screen.findByRole('dialog');expect(document.body.style.overflow).toBe('hidden');
  await userEvent.click(screen.getByRole('button',{name:'I’ll explore on my own'}));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(localStorage.getItem(TOUR_STORAGE_KEY)).toBe('skipped');expect(document.body.style.overflow).toBe('');
  app.unmount();render(<Harness/>);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('visits every tab only after its actual click, explains every control, and completes',async()=>{
  const visit=vi.fn();render(<Harness onVisit={visit}/>);await begin();
  expect(screen.getByRole('button',{name:'Previous step'})).toBeDisabled();
  await screen.findByTestId('tour-spotlight');
  for(let index=0;index<tourSteps.length;index++){
    const step=tourSteps[index];expect(screen.getByRole('heading',{name:step.title})).toBeInTheDocument();
    if(step.action==='navigate'){
      const before=visit.mock.calls.length;expect(screen.getByRole('button',{name:'Next'})).toBeDisabled();
      await userEvent.keyboard('{ArrowRight}');expect(screen.getByRole('heading',{name:step.title})).toBeInTheDocument();expect(visit).toHaveBeenCalledTimes(before);
      await userEvent.click(screen.getByRole('button',{name:step.tab}));expect(visit).toHaveBeenCalledTimes(before+1);
    } else {
      expect(screen.getByTestId('tab')).toHaveTextContent(step.tab);
      await userEvent.click(screen.getByRole('button',{name:index===tourSteps.length-1?'Start judge demo':'Next'}));
    }
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(localStorage.getItem(TOUR_STORAGE_KEY)).toBe('completed');
  expect(visit.mock.calls.map(call=>call[0])).toEqual(['Overview','Guidelines','BrandDNA','BrandTwin','Content library','Approvals','Overview']);
});
it('replays without switching tabs and waits even when the requested tab is already open',async()=>{
  localStorage.setItem(TOUR_STORAGE_KEY,'completed');const visit=vi.fn();render(<Harness initialTab="BrandTwin" onVisit={visit}/>);
  await userEvent.click(screen.getByRole('button',{name:'Replay tour'}));await begin();
  expect(screen.getByTestId('tab')).toHaveTextContent('BrandTwin');expect(visit).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button',{name:'Overview'}));expect(screen.getByRole('heading',{name:tourSteps[1].title})).toBeInTheDocument();
  await userEvent.keyboard('{ArrowLeft}');expect(screen.getByRole('heading',{name:tourSteps[0].title})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Next'})).toBeDisabled();
  await userEvent.keyboard('{Escape}');expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('requires a click when Back revisits an explanation on another tab',async()=>{
  render(<Harness/>);await begin();await reach('Start with your source documents.');
  expect(screen.getByTestId('tab')).toHaveTextContent('Guidelines');
  await userEvent.click(screen.getByRole('button',{name:'Previous step'}));
  await userEvent.click(screen.getByRole('button',{name:'Previous step'}));
  expect(screen.getByRole('heading',{name:'Return to Overview.'})).toBeInTheDocument();
  expect(screen.getByTestId('tab')).toHaveTextContent('Guidelines');expect(screen.getByRole('button',{name:'Next'})).toBeDisabled();
  await userEvent.click(screen.getByRole('button',{name:'Overview'}));expect(screen.getByRole('heading',{name:'Notice when brand knowledge changes.'})).toBeInTheDocument();
});
it('blocks unrelated background clicks but lets the highlighted tab receive its own click',async()=>{
  const visit=vi.fn();render(<Harness onVisit={visit}/>);await begin();
  await userEvent.click(screen.getByRole('button',{name:'BrandTwin'}));expect(visit).not.toHaveBeenCalled();expect(screen.getByTestId('tab')).toHaveTextContent('Overview');
  await userEvent.click(screen.getByRole('button',{name:'Overview'}));expect(visit).toHaveBeenCalledWith('Overview');
});
it('allows keyboard activation of the highlighted real navigation button',async()=>{
  render(<Harness/>);await begin();const overview=screen.getByRole('button',{name:'Overview'});overview.focus();
  await userEvent.keyboard('{Enter}');expect(screen.getByRole('heading',{name:tourSteps[1].title})).toBeInTheDocument();
  await userEvent.keyboard('{ArrowRight}');expect(screen.getByRole('heading',{name:tourSteps[2].title})).toBeInTheDocument();
});
it('waits for the destination to actually open after a highlighted tab click',async()=>{
  const view=render(<><button data-tour="nav-overview">Overview</button><Walkthrough request={0} activeTab="BrandTwin" onComplete={async()=>true}/></>);
  await begin();await userEvent.click(screen.getByRole('button',{name:'Overview'}));
  expect(screen.getByRole('heading',{name:'Click Overview to begin.'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Next'})).toBeDisabled();
  view.rerender(<><button data-tour="nav-overview">Overview</button><Walkthrough request={0} activeTab="Overview" onComplete={async()=>true}/></>);
  await screen.findByRole('heading',{name:'One workspace for every brand.'});
});
it('does not mistake a programmatic tab update for a user click',async()=>{
  const view=render(<Walkthrough request={0} activeTab="BrandTwin" onComplete={async()=>true}/>);await begin();
  view.rerender(<Walkthrough request={0} activeTab="Overview" onComplete={async()=>true}/>);
  expect(screen.getByRole('heading',{name:'Click Overview to begin.'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Next'})).toBeDisabled();
});
it('highlights the full visible section instead of truncating it to half the viewport',async()=>{
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({x:40,y:100,left:40,top:100,right:520,bottom:600,width:480,height:500,toJSON:()=>({})} as DOMRect);
  render(<Harness/>);await begin();await userEvent.click(screen.getByRole('button',{name:'Overview'}));
  await waitFor(()=>expect(screen.getByTestId('tour-spotlight')).toHaveStyle({height:'516px'}));
});
it('contains keyboard focus inside the tour card',async()=>{
  render(<Harness/>);await screen.findByRole('dialog');
  const finalButton=screen.getByRole('button',{name:'I’ll explore on my own'});finalButton.focus();await userEvent.tab();
  expect(screen.getByRole('button',{name:'Skip walkthrough'})).toHaveFocus();await userEvent.tab({shift:true});expect(finalButton).toHaveFocus();
});
it('starts the judge demo on Finish and prevents duplicate launches',async()=>{
  let resolve!:(value:boolean)=>void;
  const launch=vi.fn(()=>new Promise<boolean>(done=>{resolve=done;}));
  render(<Harness onComplete={launch}/>);await begin();await reach(tourSteps.at(-1)!.title);
  await userEvent.click(screen.getByRole('button',{name:'Start judge demo'}));
  expect(launch).toHaveBeenCalledOnce();expect(screen.getByRole('button',{name:/Preparing demo/})).toBeDisabled();
  await userEvent.keyboard('{ArrowRight}');expect(launch).toHaveBeenCalledOnce();
  expect(screen.getByRole('button',{name:'Skip tour'})).toBeDisabled();
  resolve(true);await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(localStorage.getItem(TOUR_STORAGE_KEY)).toBe('completed');
});
it('keeps Finish open with a retry when demo preparation fails',async()=>{
  const launch=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<Harness onComplete={launch}/>);await begin();await reach(tourSteps.at(-1)!.title);
  await userEvent.click(screen.getByRole('button',{name:'Start judge demo'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('The judge demo could not start.');
  expect(localStorage.getItem(TOUR_STORAGE_KEY)).toBeNull();
  await userEvent.click(screen.getByRole('button',{name:'Start judge demo'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(launch).toHaveBeenCalledTimes(2);
});
it('remains usable when a section is empty or temporarily missing',async()=>{
  render(<><button data-tour="nav-overview">Overview</button><Walkthrough request={0} activeTab="Overview" onComplete={async()=>true}/></>);await userEvent.click(await screen.findByRole('button',{name:'Show me around'}));
  await userEvent.click(screen.getByRole('button',{name:'Overview'}));expect(screen.getByRole('heading',{name:tourSteps[1].title})).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Skip tour'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('repositions the walkthrough on viewport resize',async()=>{
  render(<Harness/>);await userEvent.click(await screen.findByRole('button',{name:'Show me around'}));
  Object.defineProperty(window,'innerWidth',{configurable:true,value:375});fireEvent(window,new Event('resize'));
  expect(screen.getByRole('dialog')).toHaveStyle({width:'343px'});
  Object.defineProperty(window,'innerWidth',{configurable:true,value:1024});
});
it('keeps a narrow-screen navigation callout beside the tab instead of covering its click area',async()=>{
  Object.defineProperty(window,'innerWidth',{configurable:true,value:375});
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    return this.dataset.tour?.startsWith('nav-')?{left:8,top:250,right:62,bottom:294,x:8,y:250,width:54,height:44,toJSON:()=>({})} as DOMRect:{left:0,top:0,right:270,bottom:300,x:0,y:0,width:270,height:300,toJSON:()=>({})} as DOMRect;
  });
  render(<Harness/>);await begin();await screen.findByTestId('tour-spotlight');
  const card=screen.getByRole('dialog');
  await waitFor(()=>expect(parseFloat(card.style.left)).toBeGreaterThanOrEqual(70));
  expect(parseFloat(card.style.left)+parseFloat(card.style.width)).toBeLessThanOrEqual(359);
  Object.defineProperty(window,'innerWidth',{configurable:true,value:1024});
});
it('scrolls tall sections to their beginning so their heading stays visible',async()=>{
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({x:40,y:100,left:40,top:100,right:520,bottom:1600,width:480,height:1500,toJSON:()=>({})} as DOMRect);
  render(<Harness/>);await userEvent.click(await screen.findByRole('button',{name:'Show me around'}));
  await waitFor(()=>expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({block:'start'})));
});
it('disables sample loading until a prepared demo workspace is active',async()=>{
  const prepare=vi.fn(),load=vi.fn();render(<DemoKit ready={false} busy={false} onPrepare={prepare} onLoad={load} onTour={vi.fn()}/>);
  screen.getAllByRole('button',{name:'Try this poster'}).forEach(button=>expect(button).toBeDisabled());
  await userEvent.click(screen.getByRole('button',{name:'Prepare judge demo'}));expect(prepare).toHaveBeenCalledOnce();expect(load).not.toHaveBeenCalled();
  expect(screen.getByRole('link',{name:'Download the sample guidelines'})).toHaveAttribute('download');
});
it('loads the chosen fixture and clearly describes the four intentional differences',async()=>{
  const load=vi.fn();render(<DemoKit ready busy={false} onPrepare={vi.fn()} onLoad={load} onTour={vi.fn()}/>);
  await userEvent.click(screen.getAllByRole('button',{name:'Try this poster'})[1]);expect(load).toHaveBeenCalledWith('violations');
  expect(screen.getByText(/wrong range.*wrong price.*unsupported claim.*missing disclaimer/)).toBeInTheDocument();
  expect(screen.getAllByRole('link',{name:'PNG'})).toHaveLength(2);
});
