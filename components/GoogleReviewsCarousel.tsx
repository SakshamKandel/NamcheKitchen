'use client';

import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export type GoogleReview={id:string;name:string;rating:number;text:string;date:string;photo?:string;images?:string[];link?:string};
export type GoogleReviewSummary={name:string;rating:number;count:number;link?:string};

export default function GoogleReviewsCarousel({reviews,summary}:{reviews:GoogleReview[];summary:GoogleReviewSummary}){
  const viewport=useRef<HTMLDivElement>(null);
  const scroll=(direction:number)=>viewport.current?.scrollBy({left:direction*360,behavior:'smooth'});
  return <div className="live-reviews">
    <div className="live-reviews-toolbar"><div className="google-summary"><strong>Google</strong><span className="google-summary-name">{summary.name}</span><span className="google-rating">{summary.rating.toFixed(1)} <span aria-label={`${summary.rating} out of 5 stars`}>★★★★★</span></span><small>Read our {summary.count} reviews</small></div><div className="carousel-controls"><button type="button" onClick={()=>scroll(-1)} aria-label="Previous reviews"><ChevronLeft size={20} strokeWidth={1.5}/></button><button type="button" onClick={()=>scroll(1)} aria-label="Next reviews"><ChevronRight size={20} strokeWidth={1.5}/></button></div></div>
    <div className="live-reviews-viewport" ref={viewport}><div className="live-reviews-track">{reviews.map(review=><article className="live-review-card" key={review.id}>{review.photo?<img className="live-review-photo" src={review.photo} alt="" loading="lazy"/>:<span className="live-review-avatar" aria-hidden="true">{review.name.charAt(0)}</span>}<div className="live-review-header"><div><strong>{review.name}</strong><small>{review.date}</small></div></div><div className="live-review-stars" aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating)}</div><p>{review.text}</p>{review.images?.length?<div className="live-review-images">{review.images.slice(0,2).map((image,index)=><img key={image} src={image} alt={`${review.name} review photo ${index+1}`} loading="lazy"/>)}</div>:null}<a href={review.link||summary.link} target="_blank" rel="noreferrer">View on Google ↗</a></article>)}</div></div>
  </div>
}
