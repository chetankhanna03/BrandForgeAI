'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import Dialog from './dialog';
import Walkthrough from './walkthrough';
import JudgeDemoControls from './judge-demo-controls';
import {tourTabs,type TourTab} from './walkthrough-steps';
import DemoKit, {demoSamples, type DemoVariant} from './demo-kit';
import BrandSetup, {demoBrand, type Brand, type BrandDetails} from './brand-setup';
import BrandMediaUpload, {MediaPreview, type BrandMedia} from './brand-media';
import './brand.css';
import AccessGate, {SignOutButton, sessionExpired} from './access-gate';
import ComplianceReport, {type Finding, type Result} from './compliance-report';
import {ReactFlow, Background, Controls, MarkerType, Position, type Node, type Edge} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {ArrowUpRight, ArrowRight, Bell, BookOpen, Check, CheckCheck, ChevronDown, CircleHelp, FileText, GitBranch, Globe, Instagram, Layers3, LayoutDashboard, Linkedin, Loader2, MoreHorizontal, Plus, Search, ShieldCheck, Sparkles, Upload, X, Zap, AlertTriangle, Clock3, Send, Heart, MessageCircle, Bookmark} from 'lucide-react';

type Platform = 'Instagram' | 'LinkedIn' | 'Website';
type Rule = {id:number; name:string; kind:'fact'|'prohibited'|'required'|'color'|'semantic'; value:string; unit:string; evidence:string; source:string; approved:boolean; version:number; applies_when?:'always'|'range_claim';category?:string;severity?:string;rationale?:string};
type Draft = {id:number; title:string; content:string; platforms:Platform[]; status:string; results:Result; updated_at:string; dependencies:Record<string,number>;media_id?:string|null};
type Workspace = {profile?:Brand;media?:BrandMedia[];rules:Rule[]; drafts:Draft[]; history:{id:number; draft_id:number; action:string; note:string; created_at:string}[]};
const platforms:Platform[] = ['Instagram','LinkedIn','Website'];
const icons = {Instagram, LinkedIn:Linkedin, Website:Globe};
const badCopy = 'Meet Volt One. Go further with 500 km of range, starting at $29,999. The best in the world, built for your everyday. Drive the change. #VoltOne #ElectricFuture';
const nav = [{name:'Overview',icon:LayoutDashboard},{name:'BrandDNA',icon:GitBranch},{name:'BrandTwin',icon:Layers3},{name:'Content library',icon:FileText},{name:'Approvals',icon:ShieldCheck}];
async function requestApi<T>(path:string, data?:unknown, method='POST',brandId='demo'):Promise<T> {
  let response:Response;
  try {response=await fetch(`/api/${path}`, {signal:AbortSignal.timeout(path==='analyze'||path==='drafts'||path.endsWith('/review')?180000:15000),headers:{'X-Brand-ID':brandId,...(data===undefined?{}:{'Content-Type':'application/json'})}, ...(data===undefined?{}:{method,body:JSON.stringify(data)})});}
  catch {throw new Error('Could not reach the workspace. Check that the backend is running, then retry.');}
  if(!response.ok) {
    if(response.status===404&&path==='demo/workspace')throw new Error('The running backend does not have the judge demo route. Restart the backend from this project folder, then try again.');
    if(response.status===401)sessionExpired();
    let message='Could not reach the workspace. Check that the backend is running.';
    try {const body=await response.json();message=typeof body.detail==='string'?body.detail:Array.isArray(body.detail)?body.detail.map((item:{loc?:string[];msg?:string})=>`${item.loc?.slice(1).join(' ')||'Input'}: ${item.msg||'Invalid value'}`).join('; '):message;} catch{}
    throw new Error(message);
  }
  return response.json();
}
function Badge({status}:{status:string}) {return <span className={`badge ${status === 'approved' || status === 'pass' ? 'green' : status === 'needs_review' || status === 'changes_requested' ? 'amber' : ''}`}><i/>{status.replaceAll('_',' ')}</span>;}

export default function Home() {
  const [brandId,setBrandId]=useState('demo');
  const [demoLaunchId,setDemoLaunchId]=useState<string|null>(null);
  useEffect(()=>{try{const saved=sessionStorage.getItem('brandforge-active-brand');if(saved&&/^[0-9a-f]{32}$/.test(saved)){setBrandId(saved);if(sessionStorage.getItem('brandforge-demo-launch')===saved)setDemoLaunchId(saved);}}catch{}},[]);
  const switchBrand=(id:string)=>{try{sessionStorage.setItem('brandforge-active-brand',id);}catch{}setBrandId(id);};
  const startDemo=(id:string)=>{try{sessionStorage.setItem('brandforge-demo-launch',id);}catch{}setDemoLaunchId(id);switchBrand(id);};
  const demoConsumed=()=>{try{sessionStorage.removeItem('brandforge-demo-launch');}catch{}setDemoLaunchId(null);};
  return <AccessGate onSignIn={()=>{setDemoLaunchId(null);setBrandId('demo');}}><WorkspacePage key={brandId} brandId={brandId} onBrandChange={switchBrand} autoStartDemo={demoLaunchId===brandId} onDemoConsumed={demoConsumed} onDemoStart={startDemo}/></AccessGate>;
}

function WorkspacePage({brandId,onBrandChange,autoStartDemo,onDemoStart,onDemoConsumed}:{brandId:string;onBrandChange:(id:string)=>void;autoStartDemo:boolean;onDemoStart:(id:string)=>void;onDemoConsumed:()=>void}) {
  const api=<T,>(path:string,data?:unknown,method='POST')=>requestApi<T>(path,data,method,brandId);
  const [tab,setTab]=useState('Overview');
  const [tourRequest,setTourRequest]=useState(0);
  const startTour=()=>{setShowHelp(false);setTourRequest(value=>value+1);};
  const [graphFocus,setGraphFocus]=useState<string|null>(null);
  const [graphHover,setGraphHover]=useState<string|null>(null);
  const [workspace,setWorkspace]=useState<Workspace>({rules:[],drafts:[],history:[]});
  const profile=workspace.profile??demoBrand;
  const [brands,setBrands]=useState<Brand[]>([demoBrand]);
  const [media,setMedia]=useState<BrandMedia|null>(null);
  const [mediaUploading,setMediaUploading]=useState(false);
  const editorKey=brandId==='demo'?'brandforge-editor':`brandforge-editor:${brandId}`;
  const [loading,setLoading]=useState(true), [busy,setBusy]=useState(false), [error,setError]=useState(''), [toast,setToast]=useState('');
  const [title,setTitle]=useState('Volt One · The everyday, electrified');
  const [content,setContent]=useState(badCopy), [selected,setSelected]=useState<Platform[]>([...platforms]), [preview,setPreview]=useState<Platform>('Instagram');
  const [result,setResult]=useState<Result|null>(null), [query,setQuery]=useState(''), [editing,setEditing]=useState<Rule|null>(null), [candidates,setCandidates]=useState<Rule[]>([]);
  const [reviewNotes,setReviewNotes]=useState<Record<number,string>>({});
  const [showHelp,setShowHelp]=useState(false),[notice,setNotice]=useState(false);
  const [savedSnapshot,setSavedSnapshot]=useState('');
  const [connected,setConnected]=useState(false),[editorReady,setEditorReady]=useState(false),[dirty,setDirty]=useState(false),[candidateKey,setCandidateKey]=useState('');
  const running=useRef(false),revision=useRef(0);
  const editorSnapshot=JSON.stringify({title,content,selected,media_id:media?.id??null});
  const loadDraft=(draft:Draft)=>{
    if(mediaUploading)return;
    if(dirty&&content!==draft.content&&!window.confirm('Replace the unsaved editor copy with this saved draft?'))return;
    revision.current++;setTitle(draft.title);setContent(draft.content);setSelected(draft.platforms);setResult(null);setSavedSnapshot('');setDirty(false);setTab('BrandTwin');
    setMedia(workspace.media?.find(item=>item.id===draft.media_id)??null);
  };
  const loadApprovedSample=()=>{
    const rules=workspace.rules.filter(rule=>rule.approved);
    const range=rules.find(rule=>rule.kind==='fact'&&rule.unit==='km');
    const price=rules.find(rule=>rule.kind==='fact'&&rule.unit==='USD');
    changeContent([profile.is_demo?'Meet Volt One. Thoughtfully electric.':`Meet ${profile.product}.${profile.tagline?` ${profile.tagline}`:''}`,range?`Go further with ${range.value} km of range.`:'',price?`Starting at $${Number(price.value).toLocaleString('en-US',{maximumFractionDigits:2})}.`:'',...rules.filter(rule=>rule.kind==='required'&&(rule.applies_when!=='range_claim'||range)).map(rule=>rule.value)].filter(Boolean).join(' '));
  };
  const candidateSignature=(rule:Rule)=>JSON.stringify([rule.source,rule.kind,rule.value,rule.unit]);
  const openCandidate=(rule:Rule)=>{
    const existing=workspace.rules.find(item=>item.kind===rule.kind&&(rule.kind==='fact'?item.unit===rule.unit:item.value.toLowerCase()===rule.value.toLowerCase()));
    setCandidateKey(candidateSignature(rule));setError('');
    setEditing({...rule,id:existing?.id??0,version:existing?.version??1,approved:false});
  };
  const newContent=()=>{
    if(mediaUploading)return;
    if(dirty&&!window.confirm('Start a new draft? This replaces the unsaved copy in the editor. Saved drafts remain in your library.'))return;
    revision.current++;setTitle('Untitled content');setContent('');setSelected([...profile.platforms]);setMedia(null);setResult(null);setSavedSnapshot('');setDirty(false);setTab('BrandTwin');
  };
  const refresh=async()=>{
    const data=await api<Workspace>('workspace');setWorkspace(data);setConnected(true);
    if(!connected){
      const catalog=await api<{brands?:Brand[]}>('brands');setBrands(catalog.brands??[demoBrand]);
      if(data.profile&&!data.profile.is_demo){setTitle('Untitled content');setContent('');setSelected(data.profile.platforms);setPreview(data.profile.platforms[0]);}
      setEditorReady(true);
    }
  };
  useEffect(()=>{let live=true;
    const initialize=async()=>{
      const [data,catalog]=await Promise.all([api<Workspace>('workspace'),api<{brands?:Brand[]}>('brands')]);
      if(!live)return;
      setWorkspace(data);setBrands(catalog.brands??[demoBrand]);setConnected(true);
      if(data.profile&&!data.profile.is_demo){setTitle('Untitled content');setContent('');setSelected(data.profile.platforms);setPreview(data.profile.platforms[0]);}
      try {const stored=sessionStorage.getItem(editorKey);if(stored){const saved=JSON.parse(stored);if(typeof saved.title==='string'&&typeof saved.content==='string'&&Array.isArray(saved.selected)){setTitle(saved.title.slice(0,120));setContent(saved.content.slice(0,20000));const chosen=platforms.filter(p=>saved.selected.includes(p));setSelected(chosen);setPreview(chosen[0]??'Instagram');setMedia(data.media?.find(item=>item.id===saved.media_id)??null);setDirty(!!saved.dirty);if(typeof saved.savedSnapshot==='string')setSavedSnapshot(saved.savedSnapshot);}}}catch{}
      setEditorReady(true);
    };
    initialize().catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[]);
  useEffect(()=>{if(editorReady){try{sessionStorage.setItem(editorKey,JSON.stringify({title,content,selected,media_id:media?.id??null,dirty,savedSnapshot}));}catch{}}},[editorReady,editorKey,title,content,selected,media,dirty,savedSnapshot]);
  useEffect(()=>{if(selected.length&&!selected.includes(preview))setPreview(selected[0]);},[selected,preview]);
  useEffect(()=>{if(toast){const timer=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(timer);}},[toast]);
  const run=async(work:()=>Promise<void>)=>{if(running.current)return false;running.current=true;setBusy(true);setError('');try{await work();return true;}catch(e){setError(e instanceof Error?e.message:'Something went wrong.');return false;}finally{running.current=false;setBusy(false);}};
  const analyze=()=>run(async()=>{const version=revision.current;setResult(null);const data=await api<Result>('analyze',{title,content,platforms:selected,media_id:media?.id??null});if(version===revision.current)setResult(data);});
  const changeContent=(text:string)=>{revision.current++;setContent(text);setResult(null);setDirty(true);};
  const save=()=>run(async()=>{const snapshot=editorSnapshot,version=revision.current;const saved=await api<{results?:Result}>('drafts',{title,content,platforms:selected,media_id:media?.id??null,report_id:result?.report_id??null});if(version===revision.current){setSavedSnapshot(snapshot);setDirty(false);if(saved.results)setResult(saved.results);}setToast('Draft saved to your content library.');await refresh();});
  const reviewCorrection=async(finding:Finding,decision:'accepted'|'rejected')=>{
    if(!result?.report_id)return false;
    let succeeded=false;
    await run(async()=>{const updated=await api<{finding:Finding}>(`reports/${result.report_id}/findings/${finding.id}/review`,{decision});setResult(current=>current?{...current,findings:current.findings.map(item=>item.id===finding.id?updated.finding:item)}:current);succeeded=true;});
    return succeeded;
  };
  const switchBrand=(id:string)=>{if(id===brandId)return;if(dirty&&!window.confirm('Switch brands? Your current editor is kept in this session so you can return to it.'))return;onBrandChange(id);};
  const saveBrand=(details:BrandDetails,editing:boolean)=>run(async()=>{
    if(!editing&&dirty&&!window.confirm('Create and open this brand? Your current editor is kept in this session.'))return;
    const brand=await api<Brand>(editing?`brands/${brandId}`:'brands',details,editing?'PUT':'POST');
    if(editing){setWorkspace({...workspace,profile:brand});setBrands(brands.map(item=>item.id===brand.id?brand:item));setToast('Brand details saved.');}
    else onBrandChange(brand.id);
  });
  const uploadMedia=(file:File)=>run(()=>attachMedia(file));
  const attachMedia=async(file:File)=>{
    if(!file.size)throw new Error('Choose an image or video that is not empty.');
    if(file.size>10*1024*1024)throw new Error('Choose an image or video no larger than 10 MB.');
    const body=new FormData();body.append('file',file);
    setMediaUploading(true);
    try{
    let response:Response;
    try{response=await fetch('/api/media',{method:'POST',headers:{'X-Brand-ID':brandId},body,signal:AbortSignal.timeout(60000)});}catch{throw new Error('Media upload failed. Check the backend connection and retry.');}
    if(response.status===401)sessionExpired();
    const data=await response.json();if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Could not upload this file.');
    revision.current++;setResult(null);setMedia(data);setWorkspace(current=>({...current,media:[...(current.media??[]),data]}));setDirty(true);setToast('Media uploaded. Run a check to review the creative, then save your draft.');
    }finally{setMediaUploading(false);}
  };
  const prepareDemo=()=>startJudgeDemo();
  const startJudgeDemo=()=>run(async()=>{const brand=await api<Brand>('demo/workspace',{});if(!brand.id)throw new Error('The demo workspace could not be prepared. Retry.');onDemoStart(brand.id);});
  const loadDemoPoster=(variant:DemoVariant)=>run(async()=>{
    if(profile.demo_fixture!=='volt-v1')throw new Error('Prepare the judge demo workspace first.');
    if(dirty&&!window.confirm('Replace the open editor with this demo poster and its sample caption? Saved drafts remain in your library.'))return;
    const sample=demoSamples[variant];
    const response=await fetch(`/demo/${sample.file}`,{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Could not load the sample poster. Retry or use the PNG download.');
    const blob=await response.blob();await attachMedia(new File([blob],sample.file,{type:'image/png'}));
    setTitle(sample.title);changeContent(sample.copy);setSelected([...profile.platforms]);setPreview(profile.platforms[0]);setSavedSnapshot('');setTab('BrandTwin');
    if(autoStartDemo)onDemoConsumed();
    setToast('Sample poster and caption loaded. Run compliance check for an actual report.');
  });
  const demoStarted=useRef(false);
  useEffect(()=>{
    if(!autoStartDemo||!connected||profile.demo_fixture!=='volt-v1'||demoStarted.current)return;
    demoStarted.current=true;setTab('BrandTwin');void loadDemoPoster('approved');
  },[autoStartDemo,connected,profile.demo_fixture]);
  const review=(id:number,action:string)=>run(async()=>{try{await api(`drafts/${id}/review`,{action,note:reviewNotes[id]||''});}catch(error){await refresh();throw error;}await refresh();setToast(action==='recheck'?'Draft checked against current rules.':`Review updated: ${action.replaceAll('_',' ')}.`);});
  const saveRule=(rule:Rule)=>run(async()=>{await api(rule.id?`rules/${rule.id}`:'rules',rule,rule.id?'PUT':'POST');setResult(null);revision.current++;if(candidateKey)setCandidates(items=>items.filter(item=>candidateSignature(item)!==candidateKey));setCandidateKey('');setEditing(null);setToast('Rule saved. Approved changes flag drafts for review; unchanged rules leave them as they are.');await refresh();});
  const upload=(file:File)=>run(async()=>{
    if(file.size>10*1024*1024)throw new Error('Upload a file no larger than 10 MB.');
    if(!/\.(pdf|txt|md)$/i.test(file.name))throw new Error('Supported files: PDF, TXT, MD.');
    if(!file.size)throw new Error('This file is empty. Choose a guideline file containing text.');
    const body=new FormData();body.append('file',file);let res:Response;
    try{res=await fetch('/api/extract',{method:'POST',headers:{'X-Brand-ID':brandId},body,signal:AbortSignal.timeout(180000)});}catch{throw new Error('Upload failed. Check the backend connection and retry.');}
    if(res.status===401)sessionExpired();
    let data;try{data=await res.json();}catch{throw new Error('Upload failed. Check the backend connection and retry.');}
    if(!res.ok)throw new Error(typeof data.detail==='string'?data.detail:'Could not process this file.');
    if(data.analysis?.status==='failed')setError(`Semantic guideline extraction failed: ${data.analysis.message} Any pattern-based candidates below still require your review.`);
    setCandidates(data.candidates);setToast(data.candidates.length?`${data.candidates.length} candidates extracted${data.truncated?' (first 50 shown)':''}. Review each before activating.`:'No supported rules found. Add a rule manually or use the sample guideline file.');
  });
  const approved=workspace.rules.filter(r=>r.approved), pending=workspace.drafts.filter(d=>d.status==='pending'), impacted=workspace.drafts.filter(d=>d.status==='needs_review');
  const filtered=workspace.drafts.filter(d=>d.title.toLowerCase().includes(query.trim().toLowerCase()));
  const currentDrafts=workspace.drafts.filter(d=>d.status!=='needs_review'&&d.results.score!=null&&(!d.results.analysis||d.results.analysis.status==='complete'));
  const average=currentDrafts.length?Math.round(currentDrafts.reduce((sum,d)=>sum+(d.results.score??0),0)/currentDrafts.length):null;
  const graph=useMemo(()=>{
    const rules=workspace.rules.filter(r=>r.approved).sort((a,b)=>Number(b.kind==='fact')-Number(a.kind==='fact')||a.id-b.id);
    const spacing=144, center=(Math.max(rules.length,workspace.drafts.length,1)-1)*spacing/2;
    const ruleTop=center-(rules.length-1)*spacing/2;
    const factCount=rules.filter(r=>r.kind==='fact').length;
    const productY=factCount?ruleTop+(factCount-1)*spacing/2:center;
    const brandY=rules.length>factCount?ruleTop+(factCount+rules.length-1)*spacing/2:center;
    const nodes:Node[]=[
      {id:'brand',position:{x:0,y:brandY},data:{label:`${(workspace.profile??demoBrand).name}\nBrand identity`},className:'brand-node'},
      {id:'product',position:{x:330,y:productY},data:{label:`${(workspace.profile??demoBrand).product}\nProduct / service`},className:'product-node'},
      ...rules.map((r,i)=>({id:`r${r.id}`,position:{x:680,y:ruleTop+i*spacing},data:{label:`${r.name}\n${r.value.replaceAll('|',' · ')}${r.unit==='km'?' km':r.unit==='USD'?' USD':''}`}})),
      ...workspace.drafts.map((d,i)=>({id:`d${d.id}`,position:{x:1130,y:center-(workspace.drafts.length-1)*spacing/2+i*spacing},data:{label:`${d.title}\n${d.status.replaceAll('_',' ')}`},className:d.status==='needs_review'?'impacted-node':'draft-node'}))
    ].map(node=>{
      const [title,...description]=node.data.label.split('\n');
      return {...node,sourcePosition:Position.Right,targetPosition:Position.Left,data:{label:<div className="graph-card-copy" title={node.data.label}><strong>{title}</strong><span>{description.join(' ')}</span></div>}};
    });
    const connections:Edge[]=[
      {id:'brand-product',source:'brand',target:'product'},
      ...rules.map(r=>({id:`edge${r.id}`,source:r.kind==='fact'?'product':'brand',target:`r${r.id}`})),
      ...workspace.drafts.flatMap(d=>rules.filter(r=>String(r.id) in d.dependencies).map(r=>({id:`dependency-${r.id}-${d.id}`,source:`r${r.id}`,target:`d${d.id}`,style:{stroke:d.status==='needs_review'?'#b77b30':'#62844d'}})))
    ];
    const edges:Edge[]=connections.map(edge=>{
      const color=edge.style?.stroke||'#849481';
      return {...edge,type:'smoothstep',pathOptions:{borderRadius:18,offset:35,stepPosition:edge.source==='brand'?0.12:0.5},markerEnd:{type:MarkerType.ArrowClosed,color,width:20,height:20},style:{stroke:color,strokeWidth:1.8,pointerEvents:'none'},interactionWidth:0,zIndex:0};
    });
    return {nodes,edges};
  },[workspace]);
  const graphEdges=useMemo(()=>{
    const active=graphHover||graphFocus;
    return graph.edges.map(edge=>({...edge,style:{...edge.style,opacity:!active||edge.source===active||edge.target===active?1:0.12}}));
  },[graph.edges,graphFocus,graphHover]);

  return <div className="shell">
    <aside className="sidebar">
      <a className="logo" href="/" aria-label="BrandForge home"><span className="logo-mark"><Layers3 size={23}/></span>BrandForge<span className="ai">AI</span></a>
      <button className="workspace-switch" onClick={()=>setTab('Overview')}><span className="volt-square">{profile.name.slice(0,1).toLowerCase()}.</span><span><strong>{profile.name} workspace</strong><small>{profile.is_demo?'Example brand':'Your brand'} · Local workspace</small></span><ChevronDown size={14}/></button>
      <div className="nav-label">WORKSPACE</div>
      <nav>{nav.map(item=><button key={item.name} data-tour={tourTabs[item.name as TourTab]} aria-label={item.name} title={item.name} aria-current={tab===item.name?'page':undefined} onClick={()=>{setTab(item.name);setQuery('');}} className={tab===item.name?'active':''}><item.icon size={18}/>{item.name}{item.name==='Approvals'&&pending.length>0&&<span className="nav-count">{pending.length}</span>}{item.name==='BrandDNA'&&<span className="new-dot"/>}</button>)}</nav>
      <div className="nav-label tools-label">BRAND RESOURCES</div>
      <button data-tour="nav-guidelines" aria-current={tab==='Guidelines'?'page':undefined} aria-label="Guidelines & rules" title="Guidelines & rules" className={`resource-link ${tab==='Guidelines'?'chosen':''}`} onClick={()=>setTab('Guidelines')}><BookOpen size={18}/>Guidelines & rules</button>
      <div className="sidebar-bottom"><div className="trust-box"><span><ShieldCheck size={19}/> Built on your brand.</span><p>Every check. Every platform.<br/>One source of truth.</p><button onClick={()=>setTab('BrandDNA')}>Explore BrandDNA <ArrowUpRight size={14}/></button></div><button className="help-link" onClick={()=>setShowHelp(true)}><CircleHelp size={17}/>Quick start guide<ArrowUpRight size={14}/></button><div className="profile"><span className="avatar">BF</span><div><strong>Brand team</strong><small>Local demo workspace</small></div><span className="online"/></div></div>
    </aside>
    <div className="main-shell"><header><div className="breadcrumb">Workspace <span>/</span><strong>{tab}</strong></div><div className="header-right"><button className="walkthrough-launch" aria-label="Start walkthrough" title="Start walkthrough" disabled={busy||mediaUploading||!connected} onClick={startTour}><Sparkles size={15}/><span>Start walkthrough</span></button><span className="local-pill"><i/> Local prototype</span><button className="icon-button" data-tour="notifications" aria-label="Show notifications" onClick={()=>setNotice(!notice)}><Bell size={19}/>{impacted.length>0&&<i className="notification-dot"/>}</button><span className="header-avatar">BF</span><SignOutButton/></div></header>
    <main>
      {error&&<div className="error-banner" role="alert"><AlertTriangle size={18}/><span>{error}</span><button onClick={()=>{setError('');run(refresh);}} aria-label="Retry connection">Retry</button><button onClick={()=>setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
      {notice&&<div className="notice-panel"><strong>Workspace updates</strong><p>{impacted.length?`${impacted.length} drafts need review after brand rule changes.`:'You’re all caught up. Brand updates will appear here.'}</p><button onClick={()=>{setTab('Approvals');setNotice(false);}}>View review queue <ArrowRight size={14}/></button></div>}
      <div className="page-heading"><div><div className="eyebrow">YOUR BRAND, IN SYNC.</div><h1>{tab==='Overview'?'A little clarity. A lot of confidence.':tab==='BrandTwin'?'Create once. Check everywhere.':tab==='BrandDNA'?'The intelligence behind your brand.':tab==='Guidelines'?'Your single source of truth.':tab==='Approvals'?'Good content deserves a green light.':'Every draft. One home.'}</h1><p>{tab==='Overview'?'Your brand’s command center. Create with freedom. Publish with confidence.':tab==='BrandTwin'?'Test your message against approved brand knowledge, before it goes live.':tab==='BrandDNA'?'Connect brand facts, rules, and the content that depends on them.':tab==='Guidelines'?'Extract, review, and approve the rules that power every check.':tab==='Approvals'?'Review compliant content and revisit drafts affected by brand changes.':'Keep your work organized, compliant, and ready for its next step.'}</p></div>{(tab==='BrandTwin'||tab==='Guidelines')&&<button data-tour="new-content" className="primary" disabled={mediaUploading} onClick={newContent}><Plus size={17}/>New content</button>}</div>
      {loading?<div className="loading"><Loader2 className="spin"/>Connecting to your workspace…</div>:!connected?<div className="empty-content"><AlertTriangle size={30}/><strong>Workspace unavailable</strong><p>Start the backend and use Retry to reconnect.</p>{brandId!=='demo'&&<button className="secondary" onClick={()=>onBrandChange('demo')}>Open Volt One example</button>}</div>:<>
      {tab==='Overview'&&<>
        <section className="hero"><div className="hero-text"><span className="hero-label"><span className="pulse"/> MEET YOUR BRAND’S BETTER HALF</span><h2>Great ideas.<br/><span>Unmistakably yours.</span></h2><p>Turn your brand guidelines into a living source of truth.<br/>Then put every idea to the test, across every platform.</p><button onClick={()=>setTab('BrandTwin')}>Open BrandTwin <ArrowUpRight size={17}/></button></div><div className="orbit-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit orbit-three"/><span className="art-node node-top"><Instagram size={23}/></span><span className="art-node node-right"><Linkedin size={22}/></span><span className="art-node node-bottom"><Globe size={23}/></span><div className="core"><Layers3 size={49}/></div><div className="floating-tag"><span><Check size={13}/></span>On brand. Everywhere.</div><span className="art-spark">✳</span></div></section>
        <div data-tour="brand-setup"><BrandSetup profile={profile} brands={brands} busy={busy} onSwitch={switchBrand} onSave={saveBrand}/></div>{!profile.is_demo&&!approved.some(rule=>rule.kind!=='color')&&<div className="brand-next-step"><BookOpen size={20}/><div><strong>Next, add your brand guidelines.</strong><p>Your new workspace starts fresh. Add and approve your own rules before running compliance checks.</p></div><button className="secondary" onClick={()=>setTab('Guidelines')}>Add guidelines <ArrowRight size={15}/></button></div>}
        <div className="stats-grid" data-tour="workspace-stats">{[{label:'Approved brand rules',value:approved.length,sub:'Your source of truth',icon:GitBranch},{label:'Content checked',value:workspace.drafts.length,sub:'Saved in your workspace',icon:FileText},{label:'Average compliance',value:average===null?'—':`${average}%`,sub:average===null?'No current draft checks':'Excludes outdated draft checks',icon:ShieldCheck},{label:'Awaiting review',value:pending.length+impacted.length,sub:impacted.length?`${impacted.length} affected by rule changes`:'Keep good ideas moving',icon:Clock3}].map(s=><div className="stat-card" key={s.label}><div><span>{s.label}</span><s.icon size={18}/></div><strong>{s.value}</strong><small><i/>{s.sub}</small></div>)}</div>
        <div className="two-columns"><section className="panel recent-panel" data-tour="recent-content"><div className="panel-heading"><div><h3>Recent content</h3><p>A pulse on your latest work.</p></div><button className="text-button" onClick={()=>setTab('Content library')}>View all <ArrowUpRight size={15}/></button></div>{workspace.drafts.length?<div className="mini-list">{workspace.drafts.slice(0,4).map(d=><button key={d.id} onClick={()=>loadDraft(d)}><span className="document-icon"><FileText size={19}/></span><span><strong>{d.title}</strong><small>{d.platforms.join(' · ')}</small></span><Badge status={d.status}/><ArrowUpRight size={16}/></button>)}</div>:<div className="empty-content"><div className="stacked-docs"><FileText size={31}/><span><Plus size={12}/></span></div><strong>Your next great idea starts here.</strong><p>Run a brand check and save your first draft.</p><button className="secondary" onClick={()=>setTab('BrandTwin')}>Create your first content <ArrowRight size={14}/></button></div>}</section>
        <section className="panel dna-summary" data-tour="dna-health"><div className="panel-heading"><div><h3>BrandDNA health</h3><p>The foundation of everything you create.</p></div><span className="small-icon"><GitBranch size={18}/></span></div><div className="health-row"><div className="health-ring"><ShieldCheck size={29}/></div><div><span className={`badge ${approved.some(r=>r.kind!=='color')?'green':'amber'}`}>{approved.some(r=>r.kind!=='color')?'Ready to check':'Setup needed'}</span><h4>{approved.some(r=>r.kind!=='color')?'Your brand is connected.':'Approve rules to begin.'}</h4><p>{approved.length} approved rules · {profile.product}</p></div></div><div className="dna-breakdown"><div><span>Product facts</span><strong>{approved.filter(r=>r.kind==='fact').length}</strong></div><div><span>Voice & claims</span><strong>{approved.filter(r=>r.kind==='prohibited').length}</strong></div><div><span>Visuals & disclaimers</span><strong>{approved.filter(r=>r.kind==='color'||r.kind==='required').length}</strong></div></div><button className="dna-link" onClick={()=>setTab('BrandDNA')}>Explore your knowledge graph <ArrowUpRight size={16}/></button></section></div>
        <section className="platform-strip"><div className="platform-strip-title"><span className="small-icon"><Layers3 size={20}/></span><div><strong>One brand. Every platform.</strong><p>Your selected channels, one consistent identity.</p></div></div><div className="platform-labels">{profile.platforms.map(p=>{const Icon=icons[p];return <span key={p}><Icon size={19}/>{p}<Check size={13}/></span>;})}</div></section>
      </>}
      {tab==='Overview'&&<DemoKit ready={profile.demo_fixture==='volt-v1'} busy={busy||mediaUploading} onPrepare={prepareDemo} onLoad={loadDemoPoster} onTour={startTour}/>}
      {tab==='BrandTwin'&&<>{profile.demo_fixture==='volt-v1'&&<JudgeDemoControls brandId={brandId} busy={busy} filename={media?.filename} onLoad={loadDemoPoster}/>}<div className="studio-grid"><section className="panel editor-panel" data-tour="content-editor"><div className="panel-heading"><div><h3>Your next great message</h3><p>{profile.is_demo?'Sample campaign':profile.name} · {profile.product}</p></div><span className="badge">Text & creative review</span></div><label className="field-label" htmlFor="title">Content title</label><input data-tour="content-title" id="title" disabled={busy} value={title} onChange={e=>{revision.current++;setTitle(e.target.value);setDirty(true);}} maxLength={120}/><label className="field-label" htmlFor="copy">Marketing copy <span>{Array.from(content).length.toLocaleString()} characters</span></label><textarea data-tour="content-copy" id="copy" disabled={busy} value={content} onChange={e=>changeContent(e.target.value)} placeholder="Write your brand’s next great message…" maxLength={20000}/><div className="sample-actions" data-tour="copy-samples">{profile.is_demo&&<button disabled={busy} onClick={()=>changeContent(badCopy)}>Load sample with issues</button>}<button disabled={busy} onClick={loadApprovedSample}>{profile.is_demo?'Load approved-facts sample':'Start from brand details'}</button></div><label className="field-label">Test across platforms</label><p className="platform-choice-hint">Choose one, two, or all three for this draft.</p><div className="platform-select" data-tour="platform-check">{platforms.map(p=>{const Icon=icons[p];return <button key={p} disabled={busy} aria-pressed={selected.includes(p)} className={selected.includes(p)?'selected':''} onClick={()=>{revision.current++;setSelected(selected.includes(p)?selected.filter(v=>v!==p):[...selected,p]);setResult(null);setDirty(true);}}><Icon size={17}/>{p}{selected.includes(p)&&<Check size={14}/>}</button>;})}</div><div className="platform-choice-actions"><button type="button" className="text-button" disabled={busy} onClick={()=>{revision.current++;setSelected([...platforms]);setResult(null);setDirty(true);}}>Select all three</button>{!selected.length&&<span role="status">Choose at least one platform.</span>}</div><BrandMediaUpload media={media} busy={busy} onUpload={uploadMedia} onRemove={()=>{revision.current++;setMedia(null);setResult(null);setDirty(true);}}/><div className="editor-footer" data-tour="editor-actions"><button data-tour="save-draft" className="secondary" onClick={save} disabled={busy||(!content.trim()&&!media)||!title.trim()||!selected.length||editorSnapshot===savedSnapshot}>{editorSnapshot===savedSnapshot?'Saved':'Save draft'}</button><button data-tour="run-check" className="primary" onClick={analyze} disabled={busy||(!content.trim()&&!media)||!title.trim()||!selected.length}>{busy?<Loader2 className="spin" size={17}/>:<Sparkles size={17}/>}Run compliance check</button></div><p className="muted tiny">Exact checks plus semantic and media review. Model findings require human verification; original assets are never modified.</p></section>
      <section className="panel preview-panel" data-tour="platform-preview"><div className="panel-heading"><div><h3>BrandTwin preview</h3><p>A publishing-context mockup, in real time.</p></div><span className="live-dot">LIVE</span></div><div className="preview-tabs" data-tour="preview-tabs">{selected.map(p=>{const Icon=icons[p];return <button key={p} aria-pressed={preview===p} aria-label={`Preview ${p}`} className={preview===p?'selected':''} onClick={()=>setPreview(p)}><Icon size={18}/><span>{p}</span></button>;})}</div>{!selected.length?<div className="creative-placeholder">Select a platform to preview your branding.</div>:<div className={`social-preview ${preview.toLowerCase()}`}><div className="social-profile"><span className="volt-social">{profile.name.slice(0,1).toLowerCase()}.</span><div><strong>{preview==='Website'?(profile.website||profile.name):profile.name}</strong><small>{profile.is_demo?(preview==='LinkedIn'?'Thoughtfully electric. · Sponsored':preview==='Website'?'The everyday, electrified':'Sponsored · Original audio'):(profile.tagline||profile.industry||'Brand preview')}</small></div><MoreHorizontal size={18}/></div>{media?<MediaPreview key={media.id} media={media}/>:profile.is_demo?<div className="campaign-art"><div className="campaign-top"><span>VOLT ONE</span><ArrowUpRight size={22}/></div><div className="campaign-copy">The everyday,<br/><em>electrified.</em></div><div className="road-line"/><div className="car-shape"><div className="car-window"/><span className="wheel w1"/><span className="wheel w2"/><span className="car-light"/></div><div className="campaign-bottom"><span>MOVE WITH PURPOSE.</span><span>100% ELECTRIC</span></div></div>:<div className="creative-placeholder"><Layers3 size={34}/><strong>{profile.product}</strong><p>{profile.tagline||'Upload an image or video to see your brand here.'}</p></div>}{preview==='Instagram'&&<div className="social-actions"><Heart size={20}/><MessageCircle size={20}/><Send size={20}/><Bookmark size={20}/></div>}<div className="preview-copy"><strong>{preview==='Website'?('Discover '+profile.product):(profile.website||profile.name)}</strong> {content||'Your copy will appear here.'}</div>{preview==='Website'&&<div className="preview-cta">Explore {profile.product} <ArrowUpRight size={14}/></div>}</div>}</section></div>
      <ComplianceReport result={result} busy={busy} onReview={reviewCorrection}/></>}
      {tab==='BrandDNA'&&<><div className="graph-toolbar"><span><i className="legend-dot"/>Rule dependency <i className="legend-dot amber-dot"/>Needs review</span><button data-tour="manage-rules" className="secondary" onClick={()=>setTab('Guidelines')}><Plus size={15}/>Manage rules</button></div><div className="graph-reading-guide" data-tour="graph-guide"><strong>Brand → Product & rules → Content</strong><span>Select a card to trace its arrows. Click the canvas to reset.</span></div><div className="graph-panel" data-tour="knowledge-graph"><ReactFlow nodes={graph.nodes} edges={graphEdges} fitView fitViewOptions={{padding:0.12}} proOptions={{hideAttribution:true}} onNodeMouseEnter={(_,node)=>setGraphHover(node.id)} onNodeMouseLeave={()=>setGraphHover(null)} onNodeClick={(_,node)=>setGraphFocus(node.id)} onPaneClick={()=>setGraphFocus(null)} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} minZoom={0.15} maxZoom={1.5}><Background color="#e3e8dc" gap={28} size={1}/><Controls data-tour="graph-controls" showInteractive={false}/></ReactFlow></div><div className="info-callout"><GitBranch size={20}/><div><strong>A living map of your brand.</strong><p>Rules connect to saved drafts through their check dependencies. Updating approved knowledge flags those drafts for review. Visual rules are stored as reference only.</p></div></div></>}
      {tab==='Guidelines'&&<><section className="upload-area" data-tour="guideline-upload"><span className="upload-icon"><Upload size={25}/></span><div><h3>Give your guidelines a new life.</h3><p>Upload a text-based PDF, TXT, or Markdown file. Up to 10 MB.</p><small>Pattern + Nemotron extraction · Every candidate needs your confirmation. Split image-based PDFs into uploads of at most six visual pages.</small></div><label className={`secondary upload-label ${busy?'disabled':''}`}><Upload size={16}/>{busy?'Processing…':'Upload guidelines'}<input type="file" aria-label="Upload guidelines" accept=".pdf,.txt,.md" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)upload(file);e.target.value='';}}/></label></section>{candidates.length>0&&<section className="panel candidates" data-tour="rule-candidates"><div className="panel-heading"><div><h3>Review extracted candidates</h3><p>Confirm accuracy. Update an existing fact instead of adding a duplicate.</p></div><button className="text-button" onClick={()=>setCandidates([])}>Clear</button></div>{candidates.map((r,i)=><div className="candidate" key={i}><div><strong>{r.name} · {r.value}</strong>{r.category&&<div className="rule-metadata"><span>{r.category.replaceAll('_',' ')}</span><span>{r.severity}</span></div>}<p>{r.evidence}</p>{r.rationale&&<p>Why this rule: {r.rationale}</p>}<small>{r.source}</small></div><button className="secondary" disabled={busy} onClick={()=>openCandidate(r)}>Review candidate <ArrowRight size={14}/></button></div>)}</section>}<section className="panel" data-tour="brand-rules"><div className="panel-heading"><div><h3>Brand rules</h3><p>{profile.name} · Approved facts and editorial guidance</p></div><button data-tour="add-rule" className="secondary" disabled={busy} onClick={()=>{setError('');setCandidateKey('');setEditing({id:0,name:'',kind:'required',value:'',unit:'',evidence:'',source:'Manual brand guideline',approved:false,version:1,applies_when:'always'});}}><Plus size={15}/>Add rule</button></div><div className="rule-grid">{workspace.rules.map(r=><button className="rule-card" key={r.id} disabled={busy} onClick={()=>{setError('');setCandidateKey('');setEditing({...r,approved:!!r.approved});}}><div><span className="rule-kind">{r.kind}</span><Badge status={r.approved?'approved':'unconfirmed'}/></div><h4>{r.name}</h4><p className="rule-value">{r.kind==='color'&&<i style={{background:r.value}}/>}{r.value}{r.unit&&` ${r.unit}`}</p><p>{r.evidence}</p><footer>{r.source}<span>v{r.version} <ArrowUpRight size={13}/></span></footer></button>)}</div></section></>}
      {(tab==='Content library'||tab==='Approvals')&&<section className="panel library-panel" data-tour={tab==='Approvals'?'approval-queue':'content-library'}><div className="panel-heading"><div><h3>{tab==='Approvals'?'Review queue':'Content library'}</h3><p>{tab==='Approvals'?'A local review workflow. Demo users share a reviewer role.':'Saved drafts and their latest compliance results.'}</p></div><div className="search-input" data-tour="content-search"><Search size={16}/><input aria-label="Search saved content" placeholder="Find content…" value={query} onChange={e=>setQuery(e.target.value)}/></div></div>{filtered.filter(d=>tab!=='Approvals'||['pending','needs_review','changes_requested'].includes(d.status)).length===0?<div className="empty-content"><ShieldCheck size={33}/><strong>{query.trim()?'No matching content.':tab==='Approvals'?'Your review queue is clear.':'Your library is ready for its first draft.'}</strong><p>{query.trim()?'Try a different title or clear your search.':tab==='Approvals'?'Submit a compliant draft from the content library to begin.':'Create, check, and save content in BrandTwin.'}</p><button className="secondary" onClick={()=>setTab(tab==='Approvals'?'Content library':'BrandTwin')}>{tab==='Approvals'?'View content library':'Open BrandTwin'}<ArrowRight size={14}/></button></div>:<div className="draft-list" data-tour="library-drafts">{filtered.filter(d=>tab!=='Approvals'||['pending','needs_review','changes_requested'].includes(d.status)).map(d=><article key={d.id}><div className="draft-top"><span className="document-icon"><FileText size={19}/></span><div><h4>{d.title}</h4><small>{d.platforms.join(' · ')} · {new Date(d.updated_at).toLocaleDateString()}</small></div><Badge status={d.status}/><span className="draft-score">{d.status==='needs_review'?'Outdated':d.results.analysis&&d.results.analysis.status!=='complete'?'Incomplete':`${d.results.score}%`}</span></div><p>{d.content}</p>{d.results.findings.length>0&&<div className="impact-note"><AlertTriangle size={14}/>{d.results.findings.length} compliance findings. Edit a new version to resolve them before submitting.</div>}{d.status==='needs_review'&&<div className="impact-note"><AlertTriangle size={14}/>Brand knowledge changed. Recheck before submitting for approval.</div>}{d.status==='pending'&&<label className="field-label">Review note<input aria-label={`Review note for ${d.title}`} placeholder="Explain any requested changes, or add an approval note" value={reviewNotes[d.id]||''} maxLength={2000} disabled={busy} onChange={event=>setReviewNotes({...reviewNotes,[d.id]:event.target.value})}/></label>}<div className="draft-actions" data-tour={d.status==='pending'?'review-actions':undefined}><button className="text-button" onClick={()=>loadDraft(d)}>Edit as a new version <ArrowUpRight size={14}/></button><button className="secondary" disabled={busy} onClick={()=>review(d.id,'recheck')}>Recheck</button>{d.status==='pending'?<><button className="secondary" disabled={busy||!reviewNotes[d.id]?.trim()} onClick={()=>review(d.id,'request_changes')}>Request changes</button><button className="primary" disabled={busy} onClick={()=>review(d.id,'approve')}><Check size={15}/>Approve</button></>:d.status!=='approved'&&<button className="primary" disabled={busy||d.results.findings.length>0||d.status==='needs_review'||(!!d.results.analysis&&d.results.analysis.status!=='complete')} onClick={()=>review(d.id,'submit')}>Submit for review <ArrowRight size={14}/></button>}</div></article>)}</div>}{tab==='Approvals'&&workspace.history.length>0&&<div className="review-history" data-tour="review-history"><h4>Review history</h4>{workspace.history.map(h=><div key={h.id}><CheckCheck size={15}/><span>Draft #{h.draft_id} · {h.action.replaceAll('_',' ')}{h.note&&` · ${h.note}`}</span><small>{new Date(h.created_at).toLocaleString()}</small></div>)}</div>}</section>}
      </>}
      <footer className="page-footer"><span><Layers3 size={14}/>BrandForge AI</span><span>Built for brand integrity. Designed for creative freedom.</span><span>Hackathon prototype <i/></span></footer>
    </main></div>
    {toast&&<div className="toast" role="status"><CheckCheck size={18}/>{toast}<button onClick={()=>setToast('')} aria-label="Dismiss notification"><X size={15}/></button></div>}
    {editing&&<Dialog label={editing.id?'Edit brand rule':'Review a new rule'} busy={busy} onClose={()=>setEditing(null)}><form onSubmit={e=>{e.preventDefault();saveRule(editing);}}><div className="panel-heading"><div><h3>{editing.id?'Edit brand rule':'Review a new rule'}</h3><p>{candidateKey&&editing.id?'Matches an existing rule. Saving updates it rather than creating a duplicate.':'Approved changes trigger a draft impact check.'}</p></div><button type="button" className="icon-button" onClick={()=>setEditing(null)} aria-label="Close rule editor" disabled={busy}><X size={20}/></button></div>{error&&<div className="error-banner" role="alert">{error}</div>}<fieldset disabled={busy}><label className="field-label">Rule name<input required maxLength={120} value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></label><div className="form-row"><label className="field-label">Rule type<select value={editing.kind} onChange={e=>setEditing({...editing,kind:e.target.value as Rule['kind']})}><option value="fact">Product fact</option><option value="required">Required phrase</option><option value="prohibited">Prohibited phrases</option><option value="color">Color reference</option><option value="semantic">Semantic brand guidance</option></select></label>{editing.kind==='fact'&&<label className="field-label">Unit<select value={editing.unit} onChange={e=>setEditing({...editing,unit:e.target.value})}><option value="">Select unit</option><option value="km">km</option><option value="USD">USD</option></select></label>}</div><div className="form-row"><label className="field-label">Category<select value={editing.category||'general'} onChange={e=>setEditing({...editing,category:e.target.value})}>{['general','brand_voice','target_audience','approved_claim','prohibited_claim','disclaimer','visual_identity','restriction','terminology'].map(category=><option key={category} value={category}>{category.replaceAll('_',' ')}</option>)}</select></label><label className="field-label">Severity<select value={editing.severity||'error'} onChange={e=>setEditing({...editing,severity:e.target.value})}><option value="error">Error</option><option value="warning">Warning</option><option value="info">Information</option></select></label></div><label className="field-label">Rationale<textarea maxLength={2000} value={editing.rationale||''} onChange={e=>setEditing({...editing,rationale:e.target.value})}/></label><label className="field-label">Approved value<textarea required maxLength={2000} value={editing.value} onChange={e=>setEditing({...editing,value:e.target.value})}/></label><small className="muted">For prohibited language, separate phrases with |. Numeric facts use numbers without commas.</small><label className="field-label">Supporting evidence<textarea required maxLength={5000} value={editing.evidence} onChange={e=>setEditing({...editing,evidence:e.target.value})}/></label><label className="field-label">Source reference<input required maxLength={500} value={editing.source} onChange={e=>setEditing({...editing,source:e.target.value})}/></label>{editing.kind==='required'&&<label className="field-label">Apply this phrase<select value={editing.applies_when||'always'} onChange={e=>setEditing({...editing,applies_when:e.target.value as 'always'|'range_claim'})}><option value="always">To all content</option><option value="range_claim">Only when a numeric range is mentioned</option></select></label>}<label className="checkbox"><input type="checkbox" checked={editing.approved} onChange={e=>setEditing({...editing,approved:e.target.checked})}/>I’ve reviewed this rule and approve it for compliance checks.</label></fieldset><div className="modal-footer"><button type="button" className="secondary" disabled={busy} onClick={()=>setEditing(null)}>Cancel</button><button className="primary" disabled={busy}>{busy?<Loader2 className="spin" size={16}/>:<Check size={16}/>}Save rule</button></div></form></Dialog>}
    {!loading&&connected&&<Walkthrough request={tourRequest} activeTab={tab} onComplete={startJudgeDemo} autoWelcome={!autoStartDemo}/>}
    {showHelp&&<Dialog label="Quick start guide" onClose={()=>setShowHelp(false)}><div className="help-modal"><div className="panel-heading"><h3>Your first brand check</h3><button className="icon-button" aria-label="Close help" onClick={()=>setShowHelp(false)}><X size={19}/></button></div><p>This local prototype starts with Volt, a fictional EV brand, and six sample guidelines.</p><ol><li>Open <strong>BrandTwin</strong> and check the sample with intentional issues.</li><li>Review the evidence, correct the range and unsupported claim, and add the disclaimer.</li><li>Save passing copy, then submit it from <strong>Content library</strong>.</li><li>Approve it in <strong>Approvals</strong>.</li><li>Change the approved range in <strong>Guidelines & rules</strong> to see the draft flagged for review.</li></ol><p>Guidelines combine text patterns with Nemotron proposals that need your approval. BrandTwin checks copy and supported creative files. AI output can be uncertain; review evidence before making corrections. Publishing integrations are not included.</p><button className="secondary" onClick={startTour}>Start interactive walkthrough <ArrowRight size={15}/></button><button className="primary" onClick={()=>{setShowHelp(false);setTab('BrandTwin');}}>Let’s check some content <ArrowRight size={15}/></button></div></Dialog>}
  </div>;
}
