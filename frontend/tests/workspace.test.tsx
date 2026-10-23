import React from 'react';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import Home from '../app/page';

vi.mock('@xyflow/react',()=>({ReactFlow:({nodes,edges,children}:{nodes:unknown[];edges:unknown[];children:React.ReactNode})=><div data-testid="graph" data-nodes={JSON.stringify(nodes,(key,value)=>key==='label'&&React.isValidElement(value)?'Graph card':value)} data-edges={JSON.stringify(edges)}>{children}</div>,Background:()=>null,Controls:()=>null,MarkerType:{ArrowClosed:'closed'},Position:{Left:'left',Right:'right'}}));

const baseRule={id:1,name:'Product range',kind:'fact',value:'400',unit:'km',evidence:'Approved range is 400 km.',source:'Product specification §2.1',approved:true,version:1,applies_when:'always'};
const passing={score:100,findings:[],platforms:['Instagram','LinkedIn','Website'].map(name=>({name,passed:true,limit:2200})),engine:'Deterministic rules v1 · text only'};
const rangeFinding={id:'1-0',title:'Product range',message:'500 km is not approved.',suggestion:'400 km',matched:'500 km',source:baseRule.source,evidence:baseRule.evidence,platform:'All platforms',fix:{kind:'replace',start:4,end:10,text:'400 km'}};
const draft=(status='draft',findings:unknown[]=[])=>({id:1,title:'Launch campaign',content:'Meet Volt One. Thoughtfully electric.',platforms:['Instagram','LinkedIn','Website'],status,results:{...passing,findings},dependencies:{'1':1},updated_at:'2026-10-22T10:00:00Z'});
let workspace:{rules:typeof baseRule[];drafts:ReturnType<typeof draft>[];history:unknown[]};
let handler:(url:string,init?:RequestInit)=>Promise<Response>;
let fetchMock:ReturnType<typeof vi.fn>;
function json(body:unknown,status=200){return Promise.resolve({ok:status<400,status,json:async()=>body} as Response);}
async function ready(){render(<Home/>);await screen.findByText('Recent content');}
async function nav(name:string){await userEvent.click(screen.getByRole('button',{name}));}
async function studio(){await ready();await nav('BrandTwin');}
function posted(path:string){return fetchMock.mock.calls.filter(([url])=>url===`/api/${path}`);}
function body(path:string){return JSON.parse(posted(path).at(-1)?.[1]?.body as string);}
beforeEach(()=>{
  sessionStorage.clear();vi.restoreAllMocks();
  workspace={rules:[{...baseRule}],drafts:[],history:[]};
  handler=(url,init)=>url==='/api/workspace'?json(workspace):url==='/api/analyze'?json(passing):url==='/api/drafts'?json({id:1,results:passing}):url==='/api/extract'?json({candidates:[]}):json({updated:true});
  fetchMock=vi.fn((url:string,init?:RequestInit)=>handler(url,init));vi.stubGlobal('fetch',fetchMock);
});

describe('workspace navigation and recovery',()=>{
  it('loads live counts and each navigation destination',async()=>{
    await ready();
    expect(screen.getByText('Your next great idea starts here.')).toBeInTheDocument();
    for(const [name,heading] of [['BrandDNA','The intelligence behind your brand.'],['BrandTwin','Create once. Check everywhere.'],['Content library','Every draft. One home.'],['Approvals','Good content deserves a green light.'],['Guidelines & rules','Your single source of truth.'],['Overview','A little clarity. A lot of confidence.']]){
      await nav(name);expect(screen.getByRole('heading',{level:1,name:heading})).toBeInTheDocument();
    }
    expect(screen.getByRole('button',{name:'Overview'})).toHaveAttribute('aria-current','page');
  });
  it('shows a real offline state and recovers via Retry',async()=>{
    handler=()=>Promise.reject(new Error('offline'));render(<Home/>);
    await screen.findByText('Workspace unavailable');expect(screen.queryByText('Ready to check')).not.toBeInTheDocument();
    handler=()=>json(workspace);await userEvent.click(screen.getByRole('button',{name:'Retry connection'}));
    await screen.findByText('Recent content');
  });
  it('marks the brand as needing setup when no text rules are approved',async()=>{
    workspace.rules=[];await ready();expect(screen.getByText('Setup needed')).toBeInTheDocument();
  });
  it('opens help, traps keyboard focus, and restores focus after Escape',async()=>{
    await ready();const trigger=screen.getByRole('button',{name:/Quick start guide/});await userEvent.click(trigger);
    const dialog=screen.getByRole('dialog',{name:'Quick start guide'});expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.tab({shift:true});expect(within(dialog).getByRole('button',{name:/Let’s check/})).toHaveFocus();
    await userEvent.keyboard('{Escape}');expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(trigger).toHaveFocus();
  });
  it('renders graph rule dependencies and affected drafts',async()=>{
    workspace.drafts=[draft('needs_review')];await ready();await nav('BrandDNA');
    const graph=screen.getByTestId('graph');expect(graph.dataset.nodes).toContain('impacted-node');expect(graph.dataset.edges).toContain('dependency-1-1');
  });
  it('shows notifications and opens the review queue',async()=>{
    workspace.drafts=[draft('needs_review')];await ready();await userEvent.click(screen.getByRole('button',{name:'Show notifications'}));
    expect(screen.getByText('1 drafts need review after brand rule changes.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:/View review queue/}));expect(screen.getByRole('heading',{name:'Review queue'})).toBeInTheDocument();
  });
});

describe('BrandTwin editor and checks',()=>{
  it('creates a blank new draft',async()=>{
    await studio();await userEvent.click(screen.getByRole('button',{name:'New content'}));
    expect(screen.getByLabelText('Content title')).toHaveValue('Untitled content');expect(screen.getByLabelText(/Marketing copy/)).toHaveValue('');
    expect(screen.getByRole('button',{name:'Run compliance check'})).toBeDisabled();
  });
  it('guards unsaved content when starting another draft',async()=>{
    await studio();fireEvent.change(screen.getByLabelText(/Marketing copy/),{target:{value:'My unsaved draft'}});
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);await userEvent.click(screen.getByRole('button',{name:'New content'}));
    expect(confirm).toHaveBeenCalled();expect(screen.getByLabelText(/Marketing copy/)).toHaveValue('My unsaved draft');
  });
  it('disables check and save for whitespace-only copy or title',async()=>{
    await studio();fireEvent.change(screen.getByLabelText(/Marketing copy/),{target:{value:'  '}});
    expect(screen.getByRole('button',{name:'Run compliance check'})).toBeDisabled();expect(screen.getByRole('button',{name:'Save draft'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Marketing copy/),{target:{value:'Text'}});fireEvent.change(screen.getByLabelText('Content title'),{target:{value:' '}});
    expect(screen.getByRole('button',{name:'Save draft'})).toBeDisabled();
  });
  it('requires at least one platform and submits selected platforms only',async()=>{
    await studio();for(const name of ['Instagram','LinkedIn','Website'])await userEvent.click(screen.getByRole('button',{name}));
    expect(screen.getByRole('button',{name:'Run compliance check'})).toBeDisabled();
    await userEvent.click(screen.getByRole('button',{name:'LinkedIn'}));await userEvent.click(screen.getByRole('button',{name:'Run compliance check'}));
    await screen.findByText(/Looking good/);expect(body('analyze').platforms).toEqual(['LinkedIn']);
  });
  it('switches all three live publishing previews',async()=>{
    await studio();fireEvent.change(screen.getByLabelText(/Marketing copy/),{target:{value:'My preview copy'}});
    expect(screen.getByText('My preview copy',{exact:false,selector:'.preview-copy'})).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'Preview LinkedIn'}));expect(screen.getByText('Thoughtfully electric. · Sponsored')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'Preview Website'}));expect(screen.getByText('Discover Volt One')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'Preview Instagram'}));expect(screen.getByText('Sponsored · Original audio')).toBeInTheDocument();
  });
  it('shows evidence and safely replaces the specified Unicode occurrence',async()=>{
    handler=(url)=>url==='/api/analyze'?json({...passing,score:85,findings:[rangeFinding]}):json(workspace);
    await studio();fireEvent.change(screen.getByLabelText(/Marketing copy/),{target:{value:'⚡ 🚗 500 km then 500 km'}});
    await userEvent.click(screen.getByRole('button',{name:'Run compliance check'}));await screen.findByText(baseRule.evidence);
    expect(screen.getByText(baseRule.source)).toBeInTheDocument();await userEvent.click(screen.getByRole('button',{name:'Apply'}));
    expect(screen.getByLabelText(/Marketing copy/)).toHaveValue('⚡ 🚗 400 km then 500 km');expect(screen.queryByText(baseRule.evidence)).not.toBeInTheDocument();
  });
  it('appends a real missing disclaimer and clears obsolete results',async()=>{
    handler=url=>url==='/api/analyze'?json({...passing,findings:[{...rangeFinding,title:'Disclaimer',fix:{kind:'append',text:'Actual range may vary.'}}]}):json(workspace);
    await studio();await userEvent.click(screen.getByRole('button',{name:'Run compliance check'}));await screen.findByText('Disclaimer');
    await userEvent.click(screen.getByRole('button',{name:'Apply'}));expect((screen.getByLabelText(/Marketing copy/) as HTMLTextAreaElement).value).toContain('\n\nActual range may vary.');
    expect(screen.queryByText('Disclaimer')).not.toBeInTheDocument();
  });
  it('never offers to append content-length instructions',async()=>{
    handler=url=>url==='/api/analyze'?json({...passing,findings:[{...rangeFinding,title:'Content length',suggestion:'Shorten to 2,200 characters.',matched:'',fix:null}]}):json(workspace);
    await studio();await userEvent.click(screen.getByRole('button',{name:'Run compliance check'}));await screen.findByText('Content length');
    expect(screen.queryByRole('button',{name:'Apply'})).not.toBeInTheDocument();
  });
  it('clears results when the copy or platform choice changes',async()=>{
    await studio();await userEvent.click(screen.getByRole('button',{name:'Run compliance check'}));await screen.findByText(/Looking good/);
    await userEvent.click(screen.getByRole('button',{name:'Instagram'}));expect(screen.queryByText(/Looking good/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button',{name:'Run compliance check'}));await screen.findByText(/Looking good/);
    fireEvent.change(screen.getByLabelText(/Marketing copy/),{target:{value:'Updated'}});expect(screen.queryByText(/Looking good/)).not.toBeInTheDocument();
  });
  it('prevents double submission and ignores results for replaced content',async()=>{
    let resolve!:(value:Response)=>void;
    handler=url=>url==='/api/analyze'?new Promise(done=>{resolve=done;}):json(workspace);
    await studio();fireEvent.click(screen.getByRole('button',{name:'Run compliance check'}));fireEvent.click(screen.getByRole('button',{name:'Run compliance check'}));
    expect(posted('analyze')).toHaveLength(1);expect(screen.getByLabelText(/Marketing copy/)).toBeDisabled();
    await userEvent.click(screen.getByRole('button',{name:'New content'}));
    await act(async()=>{resolve(await json(passing));});expect(screen.queryByText(/Looking good/)).not.toBeInTheDocument();
  });
  it('persists unsaved copy across remounts',async()=>{
    const first=render(<Home/>);await screen.findByText('Recent content');await nav('BrandTwin');
    fireEvent.change(screen.getByLabelText(/Marketing copy/),{target:{value:'Persistent copy'}});first.unmount();
    render(<Home/>);await screen.findByText('Recent content');await nav('BrandTwin');expect(screen.getByLabelText(/Marketing copy/)).toHaveValue('Persistent copy');
  });
  it('tolerates corrupt editor storage',async()=>{
    sessionStorage.setItem('brandforge-editor','{broken');await studio();expect((screen.getByLabelText(/Marketing copy/) as HTMLTextAreaElement).value).toContain('Meet Volt One');
  });
  it('loads sample facts from the current approved rules',async()=>{
    workspace.rules=[{...baseRule,value:'350'}];await studio();
    await userEvent.click(screen.getByRole('button',{name:'Load approved-facts sample'}));
    const copy=(screen.getByLabelText(/Marketing copy/) as HTMLTextAreaElement).value;
    expect(copy).toContain('350 km');expect(copy).not.toContain('400 km');expect(copy).not.toContain('$29,999');
  });
  it('renders user HTML as text without injecting elements',async()=>{
    await studio();fireEvent.change(screen.getByLabelText(/Marketing copy/),{target:{value:'<img src=x onerror="alert(1)"> <script>alert(1)</script>'}});
    expect(document.querySelector('.social-preview img')).toBeNull();expect(document.querySelector('.social-preview script')).toBeNull();
    expect(document.querySelector('.preview-copy')?.textContent).toContain('<script>alert(1)</script>');
  });
  it('shows friendly API validation and supports retrying checks',async()=>{
    handler=url=>url==='/api/analyze'?json({detail:[{loc:['body','content'],msg:'Too long'}]},422):json(workspace);
    await studio();await userEvent.click(screen.getByRole('button',{name:'Run compliance check'}));await screen.findByText('content: Too long');
    handler=url=>url==='/api/analyze'?json(passing):json(workspace);await userEvent.click(screen.getByRole('button',{name:'Run compliance check'}));await screen.findByText(/Looking good/);
  });
});

describe('saved content and approvals',()=>{
  it('saves editor payload and then displays it in the library',async()=>{
    handler=(url,init)=>{if(url==='/api/drafts'){workspace.drafts=[draft()];return json({id:1});}return json(workspace);};
    await studio();await userEvent.click(screen.getByRole('button',{name:'Save draft'}));await screen.findByText('Draft saved to your content library.');
    expect(body('drafts').content).toContain('500 km');await nav('Content library');expect(screen.getByRole('heading',{name:'Launch campaign'})).toBeInTheDocument();
  });
  it('prevents saving duplicate unchanged copies and enables saving after edits',async()=>{
    await studio();await userEvent.click(screen.getByRole('button',{name:'Save draft'}));await screen.findByText('Draft saved to your content library.');
    expect(screen.getByRole('button',{name:'Saved'})).toBeDisabled();expect(posted('drafts')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(/Marketing copy/),{target:{value:'Updated campaign'}});expect(screen.getByRole('button',{name:'Save draft'})).not.toBeDisabled();
  });
  it('protects unsaved editor content when opening a saved draft',async()=>{
    workspace.drafts=[draft()];await studio();fireEvent.change(screen.getByLabelText(/Marketing copy/),{target:{value:'Unsaved work'}});
    vi.spyOn(window,'confirm').mockReturnValue(false);await nav('Content library');await userEvent.click(screen.getByRole('button',{name:/Edit as a new version/}));
    expect(screen.getByRole('heading',{name:'Content library'})).toBeInTheDocument();await nav('BrandTwin');expect(screen.getByLabelText(/Marketing copy/)).toHaveValue('Unsaved work');
  });
  it('searches case insensitively, trims spaces, and gives a distinct no-match state',async()=>{
    workspace.drafts=[draft()];await ready();await nav('Content library');
    fireEvent.change(screen.getByLabelText('Search saved content'),{target:{value:'  LAUNCH  '}});expect(screen.getByRole('heading',{name:'Launch campaign'})).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search saved content'),{target:{value:'Missing'}});expect(screen.getByText('No matching content.')).toBeInTheDocument();
  });
  it('edits a saved draft as a new version',async()=>{
    workspace.drafts=[draft()];await ready();await nav('Content library');await userEvent.click(screen.getByRole('button',{name:/Edit as a new version/}));
    expect(screen.getByLabelText('Content title')).toHaveValue('Launch campaign');expect(screen.getByLabelText(/Marketing copy/)).toHaveValue(draft().content);
  });
  it('blocks submission of failing or outdated copy with an explanation',async()=>{
    workspace.drafts=[draft('needs_review',[rangeFinding])];await ready();await nav('Content library');
    expect(screen.getByRole('button',{name:/Submit for review/})).toBeDisabled();expect(screen.getByText('Outdated')).toBeInTheDocument();expect(screen.getByText(/1 compliance findings/)).toBeInTheDocument();
  });
  it('submits passing copy through the API',async()=>{
    workspace.drafts=[draft()];await ready();await nav('Content library');await userEvent.click(screen.getByRole('button',{name:/Submit for review/}));
    await waitFor(()=>expect(body('drafts/1/review').action).toBe('submit'));
  });
  it('requires a change-request note and sends it with the review',async()=>{
    workspace.drafts=[draft('pending')];await ready();await nav('Approvals');
    const request=screen.getByRole('button',{name:'Request changes'});expect(request).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Review note for Launch campaign'),{target:{value:'Shorten the opening.'}});await userEvent.click(request);
    await waitFor(()=>expect(body('drafts/1/review')).toEqual({action:'request_changes',note:'Shorten the opening.'}));
  });
  it('approves pending content and rechecks through distinct actions',async()=>{
    workspace.drafts=[draft('pending')];await ready();await nav('Approvals');await userEvent.click(screen.getByRole('button',{name:'Approve'}));
    await waitFor(()=>expect(body('drafts/1/review').action).toBe('approve'));
    await userEvent.click(screen.getByRole('button',{name:'Recheck'}));await waitFor(()=>expect(body('drafts/1/review').action).toBe('recheck'));
  });
  it('renders human review notes in history',async()=>{
    workspace.history=[{id:1,draft_id:1,action:'request_changes',note:'Shorten the opening.',created_at:'2026-10-22T10:00:00Z'}];await ready();await nav('Approvals');
    expect(screen.getByText(/Draft #1 · request changes · Shorten the opening./)).toBeInTheDocument();
  });
});

describe('guidelines, extraction, and rule editing',()=>{
  it('opens and cancels the rule editor without mutation',async()=>{
    await ready();await nav('Guidelines & rules');await userEvent.click(screen.getByRole('button',{name:'Add rule'}));
    expect(screen.getByRole('dialog',{name:'Review a new rule'})).toBeInTheDocument();await userEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(posted('rules')).toHaveLength(0);
  });
  it('shows rule-save errors inside the open modal',async()=>{
    handler=url=>url==='/api/rules/1'?json({detail:'Conflicting approved fact.'},409):json(workspace);
    await ready();await nav('Guidelines & rules');await userEvent.click(screen.getByRole('button',{name:/Product range/}));await userEvent.click(screen.getByRole('button',{name:'Save rule'}));
    const dialog=screen.getByRole('dialog');expect(await within(dialog).findByRole('alert')).toHaveTextContent('Conflicting approved fact.');expect(within(dialog).getByLabelText('Approved value')).toHaveValue('400');
  });
  it('offers explicit applicability for required phrases',async()=>{
    await ready();await nav('Guidelines & rules');await userEvent.click(screen.getByRole('button',{name:'Add rule'}));
    expect(screen.getByLabelText('Apply this phrase')).toHaveValue('always');await userEvent.selectOptions(screen.getByLabelText('Apply this phrase'),'range_claim');expect(screen.getByLabelText('Apply this phrase')).toHaveValue('range_claim');
  });
  it('uploads a file and maps a matching candidate to the existing rule',async()=>{
    const candidate={...baseRule,value:'350',source:'guide.txt · Page 1',approved:false};
    handler=url=>url==='/api/extract'?json({candidates:[candidate]}):json(workspace);
    await ready();await nav('Guidelines & rules');await userEvent.upload(screen.getByLabelText('Upload guidelines'),new File(['Range: 350 km'],'guide.txt',{type:'text/plain'}));
    await screen.findByText('Product range · 350');await userEvent.click(screen.getByRole('button',{name:/Review candidate/}));
    const dialog=screen.getByRole('dialog',{name:'Edit brand rule'});expect(within(dialog).getByText(/Matches an existing rule/)).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox')).not.toBeChecked();await userEvent.click(within(dialog).getByRole('checkbox'));await userEvent.click(within(dialog).getByRole('button',{name:'Save rule'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(body('rules/1').value).toBe('350');expect(posted('rules/1').at(-1)?.[1]?.method).toBe('PUT');expect(screen.queryByRole('button',{name:/Review candidate/})).not.toBeInTheDocument();
  });
  it('explains an upload with no supported candidates',async()=>{
    handler=url=>url==='/api/extract'?json({candidates:[]}):json(workspace);
    await ready();await nav('Guidelines & rules');await userEvent.upload(screen.getByLabelText('Upload guidelines'),new File(['Nothing recognized'],'guide.txt'));
    expect(await screen.findByText(/No supported rules found/)).toBeInTheDocument();
  });
  it('rejects an empty file before an upload request',async()=>{
    await ready();await nav('Guidelines & rules');await userEvent.upload(screen.getByLabelText('Upload guidelines'),new File([],'empty.txt'));
    expect(await screen.findByRole('alert')).toHaveTextContent('This file is empty.');expect(posted('extract')).toHaveLength(0);
  });
  it('rejects an oversized file before sending it',async()=>{
    await ready();await nav('Guidelines & rules');const file=new File(['x'],'large.pdf');Object.defineProperty(file,'size',{value:10*1024*1024+1});
    await userEvent.upload(screen.getByLabelText('Upload guidelines'),file);expect(await screen.findByRole('alert')).toHaveTextContent('10 MB');expect(posted('extract')).toHaveLength(0);
  });
  it('handles malformed upload responses without losing the rules view',async()=>{
    handler=url=>url==='/api/extract'?Promise.resolve({ok:false,json:async()=>{throw new Error('HTML error page');}} as unknown as Response):json(workspace);
    await ready();await nav('Guidelines & rules');await userEvent.upload(screen.getByLabelText('Upload guidelines'),new File(['text'],'guide.txt'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Upload failed.');expect(screen.getByRole('heading',{name:'Brand rules'})).toBeInTheDocument();
  });
});
