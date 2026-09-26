import Script from 'next/script';

export default function Reviews(){
  return <section className="review-section">
    <div className="section-heading">
      <div><span className="eyebrow">KIND WORDS FROM OUR TABLE</span><h2>Good food.<br/><em>Happy people.</em></h2></div>
      <div><p>Live Google reviews from guests who’ve shared a meal with us.</p><a className="text-link" href="https://www.google.com/maps/search/?api=1&query=Namche+Kitchen+1230+Wellington+Ottawa" target="_blank" rel="noreferrer">Find us on Google <span aria-hidden="true">↗</span></a></div>
    </div>
    <div className="sk-ww-google-reviews review-widget" data-embed-id="25717250" />
    <Script src="https://widgets.sociablekit.com/google-reviews/widget.js" strategy="afterInteractive" />
  </section>
}
