'use client';
import {useEffect,useRef,useState} from 'react';
import {AlertTriangle,CheckCheck,FlaskConical,Loader2,PlugZap} from 'lucide-react';
import {sessionExpired} from './access-gate';
import type {DemoVariant} from './demo-kit';

export default function JudgeDemoControls({brandId,busy,filename,onLoad}:{brandId:string;busy:boolean;filename?:string;onLoad:(variant:DemoVariant)=>void}) {
  const [checking,setChecking]=useState(false),[status,setStatus]=useState<{status:string;message:string}|null>(null);
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  const check=async()=>{
    if(checking)return;setChecking(true);setStatus(null);const controller=new AbortController();request.current=controller;
    const timeout=setTimeout(()=>controller.abort('timeout'),180000);
    try{
      const response=await fetch('/api/ai/check',{method:'POST',headers:{'X-Brand-ID':brandId},signal:controller.signal});
      if(response.status===401)sessionExpired();
      const data=await response.json();if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Could not check Nemotron.');setStatus(data);
    }catch(error){if(!controller.signal.aborted||controller.signal.reason==='timeout')setStatus({status:'failed',message:controller.signal.aborted?'Connection check timed out. Retry after checking the backend.':error instanceof Error?error.message:'Could not check Nemotron.'});}
    finally{clearTimeout(timeout);if(!controller.signal.aborted||controller.signal.reason==='timeout')setChecking(false);}
  };
  return <section className="judge-live-guide" aria-label="Live judge demo">
    <div className="judge-live-heading"><span><FlaskConical size={18}/>Judge demo is ready</span><strong>{filename?.includes('violations')?'Sample B · Four deliberate differences':filename?.includes('approved')?'Sample A · Approved facts':'Choose a sample poster'}</strong></div>
    <p><strong>Next: run compliance check below.</strong> Inspect the evidence, then load the other poster and compare. Save a checked draft to continue through the library and human approval. These are real checks, not precomputed results.</p>
    <div className="judge-live-actions"><button className="secondary" disabled={busy||checking} onClick={()=>onLoad('approved')}>Load approved poster</button><button className="secondary" disabled={busy||checking} onClick={()=>onLoad('violations')}>Load poster with issues</button><button className="secondary" disabled={busy||checking} onClick={check}>{checking?<Loader2 size={14} className="spin"/>:<PlugZap size={14}/>}Check Nemotron connection</button></div>
    {status&&<div className={`judge-ai-status ${status.status==='ready'?'ready':'failed'}`} role={status.status==='ready'?'status':'alert'}>{status.status==='ready'?<CheckCheck size={17}/>:<AlertTriangle size={17}/>}<span><strong>{status.status==='ready'?'Text connection verified':status.status==='offline'?'Nemotron is disabled':'Nemotron is not ready'}</strong>{status.message}</span></div>}
  </section>;
}
