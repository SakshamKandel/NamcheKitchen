import { sameOrigin, session } from '@/lib/auth';
import { noticeDeleteSchema, noticeSchema, noticeUpdateSchema } from '@/lib/notice-input';
import { getNotices, removeNotice, saveNotice } from '@/lib/notices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    if (!await session()) return Response.json({ error: 'Please sign in.' }, { status: 401, headers });
    return Response.json(await getNotices(), { headers });
  } catch {
    return Response.json({ error: 'Unable to load notices. Please try again.' }, { status: 503, headers });
  }
}

async function changeNotice(request: Request, action: 'add' | 'edit' | 'remove') {
  try {
    if (!sameOrigin(request)) return Response.json({ error: 'Invalid request origin.' }, { status: 403, headers });
    const admin = await session();
    if (!admin) return Response.json({ error: 'Please sign in.' }, { status: 401, headers });
    const raw = await request.text();
    if (raw.length > 8000) return Response.json({ error: 'Request is too large.' }, { status: 413, headers });
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return Response.json({ error: 'Send a valid request.' }, { status: 400, headers }); }
    if (action === 'remove') {
      const parsed = noticeDeleteSchema.safeParse(input);
      if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400, headers });
      if (!await removeNotice(parsed.data.id)) return Response.json({ error: 'This notice no longer exists.' }, { status: 404, headers });
      return Response.json({ ok: true }, { headers });
    }
    if (action === 'edit') {
      const parsed = noticeUpdateSchema.safeParse(input);
      if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400, headers });
      const notice = await saveNotice(parsed.data, admin.id, parsed.data.id);
      if (!notice) return Response.json({ error: 'This notice no longer exists.' }, { status: 404, headers });
      return Response.json({ notice }, { headers });
    }
    const parsed = noticeSchema.safeParse(input);
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400, headers });
    return Response.json({ notice: await saveNotice(parsed.data, admin.id) }, { status: 201, headers });
  } catch {
    return Response.json({ error: 'Unable to update notices. Please try again.' }, { status: 503, headers });
  }
}

export async function POST(request: Request) { return changeNotice(request, 'add'); }
export async function PATCH(request: Request) { return changeNotice(request, 'edit'); }
export async function DELETE(request: Request) { return changeNotice(request, 'remove'); }
