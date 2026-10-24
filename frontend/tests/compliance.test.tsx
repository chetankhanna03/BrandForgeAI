import React from 'react';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import AccessGate, {SignOutButton,sessionExpired} from '../app/access-gate';
import ComplianceReport, {type Finding,type Result} from '../app/compliance-report';
import Walkthrough,{TOUR_STORAGE_KEY} from '../app/walkthrough';
import {LOGIN_DEMO_KEY} from '../app/demo-onboarding';

const json=(value:unknown,status=200)=>Promise.resolve({ok:status<400,status,json:async()=>value} as Response);
const base:Result={score:100,findings:[],platforms:[{name:'Instagram',passed:true,limit:2200}],engine:'Exact checks + Nemotron',report_id:'r',analysis:{status:'complete',mode:'nemotron',coverage:['exact_text','semantic_text'],limitations:[]}};
const semantic:Finding={id:'semantic-1',title:'No guarantees',message:'This promises an unsupported outcome.',suggestion:'Describe an approved benefit.',matched:'Guaranteed results.',source:'Brand policy §2',evidence:'Do not guarantee results.',rule_id:7,category:'prohibited_claim',platform:'All platforms',severity:'warning',media_type:'text',content_reference:'Marketing copy',confidence:.84,evidence_type:'inferred',origin:'semantic',review_status:'pending',fix:{kind:'replace',text:'Designed for everyday use.',start:0,end:19}};

beforeEach(()=>{vi.restoreAllMocks();sessionStorage.clear();});

describe('owner access',()=>{
  it('shows the public judge ID/password on signup and signs into the demo rather than creating an owner',async()=>{
    const demo={enabled:true,username:'judge',password:'BrandForgeDemo2026!'};
    let authenticated=false;
    const fetcher=vi.fn((url:string)=>{
      if(url==='/api/auth/status')return json({authenticated,setup_required:true,demo});
      if(url==='/api/auth/login'){authenticated=true;return json({authenticated:true,role:'judge'});}
      return json({},500);
    });vi.stubGlobal('fetch',fetcher);
    const signedIn=vi.fn();render(<AccessGate onSignIn={signedIn}><div>Judge workspace</div></AccessGate>);
    await screen.findByRole('heading',{name:'Make this workspace yours.'});
    expect(screen.getByText(demo.username,{selector:'dd'})).toBeInTheDocument();
    expect(screen.getByText(demo.password,{selector:'dd'})).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'Sign in to judge demo'}));
    await screen.findByText('Judge workspace');
    const login=fetcher.mock.calls.find(([url])=>url==='/api/auth/login');expect(login).toBeDefined();
    expect(fetcher.mock.calls.some(([url])=>url==='/api/auth/setup')).toBe(false);
    expect(signedIn).toHaveBeenCalledOnce();expect(sessionStorage.getItem(LOGIN_DEMO_KEY)).toBe('pending');
    expect(JSON.stringify(sessionStorage)).not.toContain(demo.password);
  });
  it('does not advertise a demo password when demo access is disabled',async()=>{
    vi.stubGlobal('fetch',vi.fn(()=>json({authenticated:false,setup_required:false,demo:{enabled:false}})));
    render(<AccessGate><div>Private workspace</div></AccessGate>);await screen.findByRole('button',{name:'Sign in'});
    expect(screen.queryByLabelText('Judge demo login')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Sign in to judge demo'})).not.toBeInTheDocument();
  });
  it('shows the demo welcome after each login despite an earlier completion, without repeating on refresh',async()=>{
    localStorage.setItem(TOUR_STORAGE_KEY,'completed');
    let authenticated=false;
    vi.stubGlobal('fetch',vi.fn((url:string)=>{
      if(url==='/api/auth/status')return json({authenticated,setup_required:false});
      if(url==='/api/auth/login'){authenticated=true;return json({authenticated:true});}
      if(url==='/api/auth/logout'){authenticated=false;return json({ok:true});}
      return json({});
    }));
    const view=()=> <AccessGate><SignOutButton/><Walkthrough request={0} activeTab="Overview" onComplete={async()=>true}/></AccessGate>;
    let mounted=render(view());
    for(let attempt=0;attempt<2;attempt++){
      await screen.findByRole('button',{name:'Sign in'});
      fireEvent.change(screen.getByLabelText('Password'),{target:{value:'a-local-owner-password'}});
      await userEvent.click(screen.getByRole('button',{name:'Sign in'}));
      await screen.findByRole('button',{name:'Show me around'});
      expect(sessionStorage.getItem(LOGIN_DEMO_KEY)).toBeNull();
      await userEvent.click(screen.getByRole('button',{name:'I’ll explore on my own'}));
      mounted.unmount();mounted=render(view());await screen.findByRole('button',{name:'Sign out'});
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      if(attempt===0)await userEvent.click(screen.getByRole('button',{name:'Sign out'}));
    }
  });
  it('does not queue the demo for a failed login',async()=>{
    vi.stubGlobal('fetch',vi.fn((url:string)=>url==='/api/auth/status'?json({authenticated:false,setup_required:false}):json({detail:'Incorrect username or password.'},401)));
    render(<AccessGate><div>Private workspace</div></AccessGate>);await screen.findByRole('button',{name:'Sign in'});
    fireEvent.change(screen.getByLabelText('Password'),{target:{value:'incorrect-local-password'}});
    await userEvent.click(screen.getByRole('button',{name:'Sign in'}));await screen.findByRole('alert');
    expect(sessionStorage.getItem(LOGIN_DEMO_KEY)).toBeNull();
  });
  it('requires owner setup before rendering private content',async()=>{
    let configured=false;
    const fetcher=vi.fn((url:string)=>url==='/api/auth/status'?json({authenticated:configured,setup_required:!configured}):(configured=true,json({authenticated:true},201)));
    vi.stubGlobal('fetch',fetcher);
    render(<AccessGate><div>Private workspace</div></AccessGate>);
    expect(screen.queryByText('Private workspace')).not.toBeInTheDocument();
    await screen.findByRole('heading',{name:'Make this workspace yours.'});
    fireEvent.change(screen.getByLabelText('Password'),{target:{value:'a-local-owner-password'}});
    await userEvent.click(screen.getByRole('button',{name:'Create owner account'}));
    await screen.findByText('Private workspace');
    const options=fetcher.mock.calls.find(([url])=>url==='/api/auth/setup');
    expect(options).toBeDefined();
    expect(sessionStorage.getItem(LOGIN_DEMO_KEY)).toBe('pending');
    expect(JSON.stringify(sessionStorage)).not.toContain('a-local-owner-password');
  });
  it('shows login failures and does not render the workspace',async()=>{
    vi.stubGlobal('fetch',vi.fn((url:string)=>url==='/api/auth/status'?json({authenticated:false,setup_required:false}):json({detail:'Incorrect username or password.'},401)));
    render(<AccessGate><div>Private workspace</div></AccessGate>);
    await screen.findByRole('button',{name:'Sign in'});
    fireEvent.change(screen.getByLabelText('Password'),{target:{value:'incorrect-local-password'}});
    await userEvent.click(screen.getByRole('button',{name:'Sign in'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username or password.');
    expect(screen.queryByText('Private workspace')).not.toBeInTheDocument();
  });
  it('locks the page when a session expires or is signed out',async()=>{
    vi.stubGlobal('fetch',vi.fn(()=>json({authenticated:true,setup_required:false})));
    render(<AccessGate><div>Private workspace</div><SignOutButton/></AccessGate>);
    await screen.findByText('Private workspace');
    await userEvent.click(screen.getByRole('button',{name:'Sign out'}));
    await screen.findByRole('button',{name:'Sign in'});
    expect(screen.queryByText('Private workspace')).not.toBeInTheDocument();
  });
  it('provides a retry when the authentication service is unreachable',async()=>{
    const fetcher=vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(()=>json({authenticated:true,setup_required:false}));
    vi.stubGlobal('fetch',fetcher);
    render(<AccessGate><div>Private workspace</div></AccessGate>);
    await screen.findByRole('alert');await userEvent.click(screen.getByRole('button',{name:'Retry connection'}));
    await screen.findByText('Private workspace');
  });
});

describe('unified compliance report',()=>{
  it('never shows a pass or a score when analysis failed even without findings',()=>{
    render(<ComplianceReport result={{...base,score:null,analysis:{status:'failed',message:'NVIDIA rate limit reached.'}}} busy={false} onReview={vi.fn()}/>);
    expect(screen.getByRole('alert')).toHaveTextContent('this content has not passed');
    expect(screen.getByText('NVIDIA rate limit reached.')).toBeInTheDocument();
    expect(screen.queryByText(/Your content passes/)).not.toBeInTheDocument();
    expect(screen.queryByText('100')).not.toBeInTheDocument();
  });
  it('records semantic guidance without editing content or clearing findings',async()=>{
    const review=vi.fn(async()=>true);
    render(<ComplianceReport result={{...base,score:85,findings:[semantic]}} busy={false} onReview={review}/>);
    await userEvent.click(screen.getByRole('button',{name:'Review correction'}));

    expect(screen.getByRole('dialog',{name:'Review suggested correction'})).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'Accept guidance'}));
    expect(review).toHaveBeenCalledWith(semantic,'accepted');
    expect(screen.getByText(semantic.message)).toBeInTheDocument();
  });
  it('reviews exact suggestions without an automatic apply action',async()=>{
    const review=vi.fn(async()=>true);
    const exact={...semantic,origin:'deterministic'};
    render(<ComplianceReport result={{...base,findings:[exact]}} busy={false} onReview={review}/>);
    await userEvent.click(screen.getByRole('button',{name:'Review correction'}));
    expect(screen.queryByRole('button',{name:'Apply'})).not.toBeInTheDocument();await userEvent.click(screen.getByRole('button',{name:'Accept guidance'}));expect(review).toHaveBeenCalledWith(exact,'accepted');
  });
  it('keeps review open when recording guidance fails',async()=>{
    render(<ComplianceReport result={{...base,findings:[semantic]}} busy={false} onReview={vi.fn(async()=>false)}/>);
    await userEvent.click(screen.getByRole('button',{name:'Review correction'}));
    await userEvent.click(screen.getByRole('button',{name:'Accept guidance'}));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('accepts visual guidance without modifying assets and exposes timestamps and uncertainty',async()=>{
    const review=vi.fn(async()=>true);
    const visual:Finding={...semantic,media_type:'video',content_reference:'campaign.mp4',confidence:.4,timestamp_seconds:12.5,fix:null};
    render(<ComplianceReport result={{...base,findings:[visual],observations:[{channel:'speech',text:'Guaranteed results.',certainty:'observed',timestamp_seconds:12.5}]}} busy={false} onReview={review}/>);
    expect(screen.getByText('12.5s')).toBeInTheDocument();
    expect(screen.getByText(/Uncertain interpretation/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'Review correction'}));
    await userEvent.click(screen.getByRole('button',{name:'Accept guidance'}));
    expect(review).toHaveBeenCalledWith(visual,'accepted');
  });
});
