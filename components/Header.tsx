'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState,useEffect } from 'react';
import { Menu,X,ArrowUpRight } from 'lucide-react';
import styles from './Header.module.css';
export default function Header(){const [open,setOpen]=useState(false);const path=usePathname();useEffect(()=>setOpen(false),[path]);return <header className={styles.header}><Link className={styles.brand} href="/" aria-label="Namche Kitchen home"><img src="/api/images/logo" alt=""/></Link><button className={styles.toggle} aria-label={open?'Close navigation':'Open navigation'} aria-expanded={open} aria-controls="main-navigation" onClick={()=>setOpen(!open)}>{open?<X size={21}/>:<Menu size={21}/>}</button><nav id="main-navigation" className={`${styles.nav} ${open?styles.open:''}`} aria-label="Main navigation">{[['/menu','Our menu'],['/about','Our story'],['/drinks','Drinks'],['/catering','Catering'],['/visit','Visit us']].map(([href,label])=><Link key={href} href={href} aria-current={path===href?'page':undefined}>{label}</Link>)}<Link className={styles.reserve} href="/reservations">Book a table</Link><a className={styles.order} href="https://online.namchekitchen.ca/">Order online <ArrowUpRight size={16}/></a></nav></header>}
