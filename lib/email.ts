import nodemailer from 'nodemailer';

export type ReservationEmail = {
  id: string;
  name: string;
  email: string;
  phone: string;
  date: string;
  time: string;
  guests: number;
  notes: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
};

const sender = process.env.RESERVATION_EMAIL_FROM || process.env.SMTP_USER || 'connect@namchekitchen.ca';
const owner = process.env.RESERVATION_OWNER_EMAIL || sender;

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] || character);
}

function reservationRows(reservation: ReservationEmail) {
  const rows = [
    ['Guest', reservation.name],
    ['Date', reservation.date],
    ['Time', `${reservation.time} (Ottawa)`],
    ['Guests', String(reservation.guests)],
    ['Phone', reservation.phone],
    ['Reference', reservation.id.slice(0, 8).toUpperCase()],
    ['Status', reservation.status],
  ];
  return rows.map(([label, value]) => `<tr><td style="padding:9px 0;color:#68746b;font-size:13px;width:110px">${label}</td><td style="padding:9px 0;color:#17372c;font-size:14px;font-weight:600">${escapeHtml(value)}</td></tr>`).join('');
}

function layout(title: string, intro: string, content: string) {
  return `<!doctype html><html><body style="margin:0;background:#f5f2e9;color:#17372c;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto;padding:34px 22px"><div style="background:#15382e;color:#f5f2e9;padding:24px 26px"><div style="font-size:12px;letter-spacing:2px;color:#e9b461;font-weight:700">NAMCHE KITCHEN</div><div style="font-size:12px;letter-spacing:1px;margin-top:6px">THE TASTE OF NEPAL · OTTAWA</div></div><div style="background:#fffdf7;padding:30px 26px"><h1 style="margin:0 0 14px;font-size:27px;font-weight:600;color:#17372c">${title}</h1><p style="margin:0 0 24px;line-height:1.65;color:#526259">${intro}</p>${content}</div><p style="margin:18px 0 0;text-align:center;font-size:12px;color:#68746b">1230 Wellington St. W · Ottawa, ON · (613) 761-1616</p></div></body></html>`;
}

function getTransport() {
  const password = process.env.SMTP_PASSWORD;
  if (!password) return null;
  return nodemailer.createTransport({ host: process.env.SMTP_HOST || 'smtp.hostinger.com', port: Number(process.env.SMTP_PORT || 465), secure: (process.env.SMTP_SECURE || 'true') === 'true', auth: { user: process.env.SMTP_USER || sender, pass: password } });
}

export async function sendReservationEmails(reservation: ReservationEmail) {
  const transport = getTransport();
  if (!transport) return false;
  const details = `<table style="width:100%;border-collapse:collapse;margin:4px 0 22px">${reservationRows(reservation)}</table>${reservation.notes ? `<div style="border-left:3px solid #e9b461;padding:10px 14px;background:#f7f4eb;color:#526259;font-size:14px;line-height:1.6"><strong>Guest notes</strong><br/>${escapeHtml(reservation.notes)}</div>` : ''}`;
  const guestHtml = layout('Your reservation request is received', `Namaste ${escapeHtml(reservation.name)}, thank you for choosing Namche Kitchen. We have received your request and our team will contact you to confirm availability.`, `${details}<p style="margin:22px 0 0;color:#526259;line-height:1.65">Your request is currently <strong>pending</strong>. Please call us at (613) 761-1616 if you need to make a same-day change.</p>`);
  const ownerHtml = layout('New reservation request', 'A new reservation request has been submitted through the Namche Kitchen website.', `${details}<p style="margin:22px 0 0;color:#526259;line-height:1.65">Reply to this email or contact the guest directly to confirm the table.</p>`);
  await Promise.all([
    transport.sendMail({ from: sender, to: reservation.email, replyTo: owner, subject: 'Namche Kitchen · Reservation request received', html: guestHtml, text: `Namaste ${reservation.name}, your reservation request for ${reservation.date} at ${reservation.time} is pending. Reference: ${reservation.id.slice(0, 8).toUpperCase()}. We will contact you to confirm availability.` }),
    transport.sendMail({ from: sender, to: owner, replyTo: reservation.email, subject: `New reservation request · ${reservation.date} · ${reservation.time}`, html: ownerHtml, text: `New reservation request from ${reservation.name}: ${reservation.date} at ${reservation.time}, ${reservation.guests} guests. Email: ${reservation.email}. Phone: ${reservation.phone}. Reference: ${reservation.id.slice(0, 8).toUpperCase()}.` }),
  ]);
  return true;
}

export async function sendReservationStatusEmail(reservation: ReservationEmail) {
  const transport = getTransport();
  if (!transport) return false;
  const statusCopy = {
    confirmed: ['Your table is confirmed', 'Wonderful news — our team has confirmed your reservation. We look forward to welcoming you.'],
    cancelled: ['Your reservation has been cancelled', 'Your reservation request has been cancelled. Please call us if you need help arranging another time.'],
    completed: ['Thank you for dining with us', 'Thank you for visiting Namche Kitchen. We hope to welcome you back soon.'],
    pending: ['Your reservation request is pending', 'Your reservation request is still awaiting confirmation from our team.'],
  } as const;
  const [title, intro] = statusCopy[reservation.status];
  const html = layout(title, `Namaste ${escapeHtml(reservation.name)}, ${intro}`, `<table style="width:100%;border-collapse:collapse;margin:4px 0 22px">${reservationRows(reservation)}</table>`);
  await transport.sendMail({ from: sender, to: reservation.email, replyTo: owner, subject: `Namche Kitchen · ${title}`, html, text: `${title}. ${intro} Reservation: ${reservation.date} at ${reservation.time}. Reference: ${reservation.id.slice(0, 8).toUpperCase()}.` });
  return true;
}
