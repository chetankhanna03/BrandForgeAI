'use client';

import {useState} from 'react';
import {Upload, X, FileImage} from 'lucide-react';

export type BrandMedia={id:string;filename:string;mime:string;kind:'image'|'video';url:string};

export function MediaPreview({media}:{media:BrandMedia}) {
  const [failed,setFailed]=useState(false);
  if(failed)return <div className="creative-placeholder" role="status"><FileImage size={30}/><p>This file cannot be displayed by your browser. Try a PNG/JPEG image or an MP4 video.</p></div>;
  return media.kind==='video'?<video className="brand-creative" controls playsInline preload="metadata" src={media.url} aria-label={`Brand video: ${media.filename}`} onError={()=>setFailed(true)}/>:<img className="brand-creative" src={media.url} alt={`Brand creative: ${media.filename}`} onError={()=>setFailed(true)}/>;
}

export default function BrandMediaUpload({media,busy,onUpload,onRemove}:{media:BrandMedia|null;busy:boolean;onUpload:(file:File)=>void;onRemove:()=>void}) {
  return <section className="brand-media-upload" aria-label="Brand image or video"><div className="media-upload-heading"><strong>Brand image or video</strong><span>Optional</span></div><p>Upload your campaign creative or a picture or video of your branding account.</p><label className={`secondary upload-label ${busy?'disabled':''}`}><Upload size={16}/>{media?'Replace media':'Upload image or video'}<input type="file" aria-label="Upload brand image or video" disabled={busy} accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,.mov" onChange={e=>{const file=e.target.files?.[0];if(file)onUpload(file);e.target.value='';}}/></label>{media&&<div className="attached-media"><FileImage size={18}/><span>{media.filename}</span><button type="button" className="icon-button" disabled={busy} aria-label="Remove attached media" onClick={onRemove}><X size={17}/></button></div>}<small>PNG, JPEG, GIF, WebP, MP4, WebM or MOV · Up to 10 MB.<br/>JPEG/PNG and MP4 support compliance review; videos must be at most 120 seconds. Other formats are preview-only. Model review samples frames and may miss brief scenes.</small></section>;
}
