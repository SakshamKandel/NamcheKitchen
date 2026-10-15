import { getNotices } from '@/lib/notices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    const { notices } = await getNotices(true);
    return Response.json({ notices }, { headers });
  } catch {
    return Response.json({ error: 'Unable to load notices.' }, { status: 503, headers });
  }
}
