'use client';

import Cropper, { Area, Point } from 'react-easy-crop';
import { useCallback, useState } from 'react';

function loadImage(src:string){return new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=src})}

async function createCroppedBlob(src:string,pixels:Area){
  const image=await loadImage(src);const canvas=document.createElement('canvas');canvas.width=pixels.width;canvas.height=pixels.height;const context=canvas.getContext('2d');if(!context)throw new Error('Canvas unavailable');context.drawImage(image,pixels.x,pixels.y,pixels.width,pixels.height,0,0,pixels.width,pixels.height);return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not create crop')),'image/jpeg',.92));
}

export default function ImageCropper({src,onCancel,onComplete}:{src:string;onCancel:()=>void;onComplete:(blob:Blob)=>void}){
  const [crop,setCrop]=useState<Point>({x:0,y:0});const [zoom,setZoom]=useState(1);const [area,setArea]=useState<Area|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const finish=useCallback(async()=>{if(!area)return;setBusy(true);setError('');try{onComplete(await createCroppedBlob(src,area))}catch(e){setError(e instanceof Error?e.message:'Could not crop this image.')}finally{setBusy(false)}},[area,onComplete,src]);
  return <div className="crop-editor" role="dialog" aria-modal="true" aria-label="Crop menu image"><div className="crop-stage"><Cropper image={src} crop={crop} zoom={zoom} aspect={4/3} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_,pixels)=>setArea(pixels)}/></div><label className="crop-zoom">Zoom<input type="range" min={1} max={3} step={.05} value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label>{error&&<p className="form-error">{error}</p>}<div className="editor-actions"><button type="button" className="button" onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className="button dark" onClick={finish} disabled={busy||!area}>{busy?'Preparing…':'Use this crop'}</button></div></div>
}
