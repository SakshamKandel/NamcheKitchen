'use client';

import useEmblaCarousel from 'embla-carousel-react';
import { useCallback, useEffect, useState } from 'react';

export type GoogleReview = {
  id: string;
  name: string;
  rating: number;
  text: string;
  date: string;
  photo?: string;
  images?: string[];
  link?: string;
};

export type GoogleReviewSummary = { name: string; rating: number; count: number; link?: string };

export default function GoogleReviewsCarousel({reviews,summary}:{reviews:GoogleReview[];summary:GoogleReviewSummary}){
  const [viewportRef, emblaApi] = useEmblaCarousel({align:'start',containScroll:'trimSnaps',dragFree:true});
  const [canPrev,setCanPrev]=useState(false); const [canNext,setCanNext]=useState(false);
  const updateButtons=useCallback(()=>{if(!emblaApi)return;setCanPrev(emblaApi.canScrollPrev());setCanNext(emblaApi.canScrollNext())},[emblaApi]);
  useEffect(()=>{if(!emblaApi)return;updateButtons();emblaApi.on('select',updateButtons);emblaApi.on('reInit',updateButtons);return()=>{emblaApi.off('select',updateButtons);emblaApi.off('reInit',updateButtons)}},[emblaApi,updateButtons]);
  return <div className="live-reviews">
    <div className="live-reviews-toolbar"><div className="google-summary"><strong>Google</strong><span className="google-summary-name">{summary.name}</span><span className="google-rating">{summary.rating.toFixed(1)} <span aria-label={`${summary.rating} out of 5 stars`}>★★★★★</span></span><small>Read our {summary.count} reviews</small></div><div className="carousel-controls"><button type="button" onClick={()=>emblaApi?.scrollPrev()} disabled={!canPrev} aria-label="Previous reviews">←</button><button type="button" onClick={()=>emblaApi?.scrollNext()} disabled={!canNext} aria-label="Next reviews">→</button></div></div>
    <div className="live-reviews-viewport" ref={viewportRef}><div className="live-reviews-track">{reviews.map(review=><article className="live-review-card" key={review.id}><div className="live-review-header">{review.photo?<img src={review.photo} alt="" loading="lazy"/>:<span className="live-review-avatar" aria-hidden="true">{review.name.charAt(0)}</span>}<div><strong>{review.name}</strong><small>{review.date}</small></div></div><div className="live-review-stars" aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating)}</div><p>{review.text}</p>{review.images?.length?<div className="live-review-images">{review.images.slice(0,2).map((image,index)=><img key={image} src={image} alt={`${review.name} review photo ${index+1}`} loading="lazy"/>)}</div>:null}<a href={review.link||summary.link} target="_blank" rel="noreferrer">View on Google ↗</a></article>)}</div></div>
  </div>
}
