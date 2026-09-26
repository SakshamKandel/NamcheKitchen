'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <section className="page-intro"><span className="eyebrow">A SMALL INTERRUPTION</span><h1>WE’LL BE RIGHT BACK.</h1><p>We couldn’t load this page. Please try again, or call (613) 761-1616.</p><button onClick={reset} className="button gold">Try again</button></section>}
