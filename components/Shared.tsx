import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
export function PageIntro({label,title,children}:{label:string;title:string;children?:React.ReactNode}){return <section className="page-intro"><span className="eyebrow">{label}</span><h1>{title}</h1>{children&&<div className="intro-copy">{children}</div>}</section>}
export function TableCTA(){return <section className="table-cta"><span className="eyebrow">Good food. WARM COMPANY.</span><h2>Your table<br/><em>is waiting.</em></h2><p>Come hungry. Leave with a little taste of Nepal.</p><Link href="/reservations" className="button gold">Reserve a table <ArrowUpRight size={18}/></Link></section>}
export const money=(value:number|string|null)=>value===null?'Ask your server':`$${Number(value).toFixed(Number(value)%1?2:0)}`;
