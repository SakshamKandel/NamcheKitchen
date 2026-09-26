'use client';
import { useEffect, useRef, useState } from 'react';
export default function HeroImage(){const [attempt,setAttempt]=useState(0);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[]);return <img className="hero-image" src={`/api/images/restaurant-outdoor-v2${attempt?`?retry=${attempt}`:''}`} alt="The warmly lit exterior of Namche Kitchen in Ottawa" fetchPriority="high" loading="eager" onError={()=>{if(attempt<3)timer.current=setTimeout(()=>setAttempt(n=>n+1),1000*(attempt+1));}}/>}
