'use client';
import {useEffect, useState} from 'react';
import {ShieldCheck, Loader2, FlaskConical, ArrowRight} from 'lucide-react';
import './compliance.css';
import {LOGIN_DEMO_KEY} from './demo-onboarding';

export function sessionExpired(){if(typeof window!=='undefined')window.dispatchEvent(new Event('brandforge-session-expired'));}

export default function AccessGate({children,onSignIn}:{children:React.ReactNode;onSignIn?:()=>void}) {
  const [status,setStatus]=useState<{authenticated:boolean;setup_required:boolean;demo?:{enabled:boolean;username?:string;password?:string}}|null>(null);
  const [username,setUsername]=useState('owner'),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const check=async()=>{setError('');try{const response=await fetch('/api/auth/status',{signal:AbortSignal.timeout(15000),cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json();if(typeof data.authenticated!=='boolean')throw new Error();setStatus(data);}catch{setError('Could not reach the workspace. Start the backend, then retry.');}};
  useEffect(()=>{check();const expired=()=>{setStatus({authenticated:false,setup_required:false});setPassword('');setError('Your session ended. Sign in again.');};window.addEventListener('brandforge-session-expired',expired);return()=>window.removeEventListener('brandforge-session-expired',expired);},[]);
  if(status?.authenticated)return <>{children}</>;
  const authenticate=async(credentials:{username:string;password:string},demo=false)=>{
    if(busy)return;setBusy(true);setError('');
    try{
      const response=await fetch(`/api/auth/${status?.setup_required&&!demo?'setup':'login'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials),signal:AbortSignal.timeout(15000)});
      const data=await response.json();if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Check your username and password (at least 12 characters).');
      try{sessionStorage.setItem(LOGIN_DEMO_KEY,'pending');sessionStorage.removeItem('brandforge-demo-launch');sessionStorage.setItem('brandforge-active-brand','demo');}catch{}
      onSignIn?.();setPassword('');await check();
    }catch(e){setError(e instanceof Error?e.message:'Sign in failed. Please retry.');}finally{setBusy(false);}
  };
  const submit=(event:React.FormEvent)=>{event.preventDefault();void authenticate({username,password},status?.demo?.enabled&&username===status.demo.username&&password===status.demo.password);};
  const enterDemo=()=>{if(status?.demo?.enabled&&status.demo.username&&status.demo.password)void authenticate({username:status.demo.username,password:status.demo.password},true);};

  return <main className="access-page"><section className="access-card"><ShieldCheck size={34}/><h1>{status?.setup_required?'Make this workspace yours.':'Welcome to BrandForge AI.'}</h1><p>{status?.setup_required?'Create the owner account on this computer. It protects all brands, guidelines, drafts, and media in this local workspace.':'Sign in to review your brand content.'}</p>{error&&<div className="error-banner" role="alert">{error}</div>}{!status?<button className="secondary" onClick={check}>{error?'Retry connection':<><Loader2 className="spin" size={16}/>Connecting…</>}</button>:<form onSubmit={submit}><fieldset disabled={busy}><label className="field-label">Username<input required maxLength={80} autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} pattern="[a-zA-Z0-9_.@-]+"/></label><label className="field-label">Password<input type="password" required minLength={12} maxLength={256} autoComplete={status.setup_required?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label><small>Use at least 12 characters. Your NVIDIA API key stays in backend/.env.</small><button className="primary" disabled={busy}>{busy?<Loader2 className="spin" size={16}/>:<ShieldCheck size={16}/>} {status.setup_required?'Create owner account':'Sign in'}</button></fieldset></form>}{status?.demo?.enabled&&status.demo.username&&status.demo.password&&<section className="demo-access" aria-label="Judge demo login"><div className="demo-access-heading"><FlaskConical size={20}/><div><strong>Here to try the hackathon demo?</strong><p>Use this shared demo login. No signup needed.</p></div></div><dl className="demo-credentials"><div><dt>Demo ID</dt><dd>{status.demo.username}</dd></div><div><dt>Demo password</dt><dd>{status.demo.password}</dd></div></dl><button type="button" className="secondary" disabled={busy} onClick={enterDemo}>{busy?<Loader2 className="spin" size={15}/>:<ArrowRight size={15}/>}Sign in to judge demo</button><small>Each demo login opens a fresh sandbox with sample Volt rules. Your demo activity is separate from the owner's private workspaces. The walkthrough appears after sign-in.</small></section>}</section></main>;
}

export function SignOutButton(){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <><button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const response=await fetch('/api/auth/logout',{method:'POST',signal:AbortSignal.timeout(15000)});if(!response.ok&&response.status!==401)throw new Error();sessionExpired();}catch{setError('Sign out failed. Retry.');}finally{setBusy(false);}}}>Sign out</button>{error&&<span role="alert">{error}</span>}</>;
}
