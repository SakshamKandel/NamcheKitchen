import { sql } from '@/lib/db';
import GoogleReviewsCarousel, { GoogleReview, GoogleReviewSummary } from './GoogleReviewsCarousel';

type Feed={bio?:{name?:string;overall_star_rating?:number;rating_count?:number;link?:string};reviews?:Array<{id?:string;reviewer_name?:string;rating?:number;review_text?:string;review_date_time?:string;reviewer_photo_link?:string;reviewer_link?:string;images?:string[]}>};

async function getGoogleReviews(){
  try{
    const response=await fetch('https://data.accentapi.com/feed/25717250.json?nocache='+Date.now(),{cache:'no-store'});
    if(response.ok){const feed=await response.json() as Feed;const summary:GoogleReviewSummary={name:feed.bio?.name||'Namche Kitchen',rating:feed.bio?.overall_star_rating||5,count:feed.bio?.rating_count||0,link:feed.bio?.link};const reviews=(feed.reviews||[]).filter(r=>r.review_text).map((r,index):GoogleReview=>({id:r.id||String(index),name:r.reviewer_name||'Google guest',rating:r.rating||5,text:r.review_text||'',date:r.review_date_time?new Intl.DateTimeFormat('en-CA',{dateStyle:'medium'}).format(new Date(r.review_date_time)):'Recent review',photo:r.reviewer_photo_link,images:r.images,link:r.reviewer_link}));if(reviews.length)return {summary,reviews};}
  }catch{}
  const fallback=await sql`select id,name,excerpt as text,rating from namche.reviews order by sort_order`;
  return {summary:{name:'Namche Kitchen',rating:5,count:fallback.length,link:'https://www.google.com/maps/search/?api=1&query=Namche+Kitchen+1230+Wellington+Ottawa'},reviews:fallback.map((r,index)=>({id:r.id,name:r.name,rating:r.rating,text:r.text,date:'Google review',link:'https://www.google.com/maps/search/?api=1&query=Namche+Kitchen+1230+Wellington+Ottawa'} as GoogleReview))};
}

export default async function Reviews(){const {summary,reviews}=await getGoogleReviews();return <section className="review-section"><div className="section-heading"><div><span className="eyebrow">KIND WORDS FROM OUR TABLE</span><h2>Good food.<br/><em>Happy people.</em></h2></div><div><p>Latest Google reviews from guests who’ve shared a meal with us.</p><a className="text-link" href={summary.link} target="_blank" rel="noreferrer">Find us on Google <span aria-hidden="true">↗</span></a></div></div><GoogleReviewsCarousel reviews={reviews} summary={summary}/></section>}
