import { digest,rateLimit,sameOrigin } from '@/lib/auth';
import { reservationSchema } from '@/lib/validation';
import { sendReservationEmails } from '@/lib/email';
import { createReservationResult, getReservationClosure } from '@/lib/reservations';
import { CLOSED_DATE_MESSAGE } from '@/lib/reservation-dates';

export const runtime = 'nodejs';
function closedDateResponse(reason = '') {
  return Response.json({error:reason ? `Reservations are closed on this date: ${reason} Please choose another day.` : CLOSED_DATE_MESSAGE,code:'RESERVATION_DATE_CLOSED',reason},{status:409});
}

export async function POST(request:Request) {
  try {
    if(!sameOrigin(request)) return Response.json({error:'Invalid request origin.'},{status:403});
    const raw=await request.text();
    if(raw.length>6000) return Response.json({error:'Request is too large.'},{status:413});
    let input: unknown;
    try { input=JSON.parse(raw); } catch { return Response.json({error:'Send a valid reservation request.'},{status:400}); }
    const parsed=reservationSchema.safeParse(input);
    if(!parsed.success) return Response.json({error:parsed.error.issues[0].message},{status:400});
    const data=parsed.data;
    const closure=await getReservationClosure(data.date);
    if(closure) return closedDateResponse(closure.reason);
    if(!await rateLimit('booking:'+digest(data.email.toLowerCase()),3,60)||!await rateLimit('bookings-global',100,60)) {
      return Response.json({error:'Too many requests. Please call us to arrange your table.'},{status:429});
    }
    // Recheck under the date lock in case staff closed it after the early check.
    const {id,closedReason}=await createReservationResult(data);
    if(!id) return closedDateResponse(closedReason || '');
    try { await sendReservationEmails({...data,id,status:'pending'}); } catch(error) { console.error('Reservation email delivery failed',error); }
    return Response.json({id,message:'Your request is saved. Our team will contact you to confirm your table.'},{status:201});
  } catch {
    return Response.json({error:'We could not save your request. Please try again or call (613) 761-1616.'},{status:503});
  }
}
