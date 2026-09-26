import PageSections from '@/components/PageSections';
import { PageIntro } from '@/components/Shared';
import ReservationForm from '@/components/ReservationForm';
export const metadata={title:'Reserve a Table'};
export default function Reservations(){return <><PageIntro label="WE’RE DELIGHTED TO HAVE YOU AT OUR TABLE" title="COME FOR THE FOOD. STAY FOR THE WARMTH."/><section className="booking-layout section-pad"><div className="booking-aside"><img src="/api/images/restaurant" alt="Warm evening lights at Namche Kitchen"/><h2>A WARM WELCOME.<br/><em>EVERY TIME.</em></h2><p>1230 Wellington St. W<br/>Ottawa, ON K1Y 3A1</p><p>For same-day plans or groups larger than 20, please call <a href="tel:+16137611616">(613) 761-1616</a>.</p><p>All times are in Ottawa local time. Requests are subject to opening hours and table availability.</p></div><ReservationForm/></section><PageSections page="reservations"/></>}
