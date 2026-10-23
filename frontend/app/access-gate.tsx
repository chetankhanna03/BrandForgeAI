'use client';
import {useEffect, useState} from 'react';
import {ShieldCheck, Loader2} from 'lucide-react';
import './compliance.css';

export function sessionExpired(){if(typeof window!=='undefined')window.dispatchEvent(new Event('brandforge-session-expired'));}

export default function AccessGate({children}:{children:React.ReactNode}) {
  const [status,setStatus]=useState<{authenticated:boolean;setup_required:boolean}|null>(null);
  const [username,setUsername]=useState('owner'),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const check=async()=>{setError('');try{const response=await fetch('/api/auth/status',{signal:AbortSignal.timeout(15000),cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json();if(typeof data.authenticated!=='boolean')throw new Error();setStatus(data);}catch{setError('Could not reach the workspace. Start the backend, then retry.');}};
  useEffect(()=>{check();const expired=()=>{setStatus({authenticated:false,setup_required:false});setPassword('');setError('Your session ended. Sign in again.');};window.addEventListener('brandforge-session-expired',expired);return()=>window.removeEventListener('brandforge-session-expired',expired);},[]);
  if(status?.authenticated)return <>{children}</>;
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{const response=await fetch(`/api/auth/${status?.setup_required?'setup':'login'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password}),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Check your username and password (at least 12 characters).');setPassword('');await check();}catch(e){setError(e instanceof Error?e.message:'Sign in failed. Please retry.');}finally{setBusy(false);}};
  return <main className="access-page"><section className="access-card"><ShieldCheck size={34}/><h1>{status?.setup_required?'Make this workspace yours.':'Welcome to BrandForge AI.'}</h1><p>{status?.setup_required?'Create the owner account on this computer. It protects all brands, guidelines, drafts, and media in this local workspace.':'Sign in to review your brand content.'}</p>{error&&<div className="error-banner" role="alert">{error}</div>}{!status?<button className="secondary" onClick={check}>{error?'Retry connection':<><Loader2 className="spin" size={16}/>Connecting…</>}</button>:<form onSubmit={submit}><fieldset disabled={busy}><label className="field-label">Username<input required maxLength={80} autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} pattern="[a-zA-Z0-9_.@-]+"/></label><label className="field-label">Password<input type="password" required minLength={12} maxLength={256} autoComplete={status.setup_required?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label><small>Use at least 12 characters. Your NVIDIA API key stays in backend/.env.</small><button className="primary" disabled={busy}>{busy?<Loader2 className="spin" size={16}/>:<ShieldCheck size={16}/>} {status.setup_required?'Create owner account':'Sign in'}</button></fieldset></form>}</section></main>;
}

export function SignOutButton(){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <><button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const response=await fetch('/api/auth/logout',{method:'POST',signal:AbortSignal.timeout(15000)});if(!response.ok&&response.status!==401)throw new Error();sessionExpired();}catch{setError('Sign out failed. Retry.');}finally{setBusy(false);}}}>Sign out</button>{error&&<span role="alert">{error}</span>}</>;
}
