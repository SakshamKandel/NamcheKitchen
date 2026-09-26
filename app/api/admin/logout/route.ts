import { cookies } from 'next/headers';
import { digest,sameOrigin } from '@/lib/auth';
import { sql } from '@/lib/db';
export async function POST(request:Request){if(!sameOrigin(request))return new Response(null,{status:403});const jar=await cookies();const token=jar.get('namche_session')?.value;if(token)await sql`delete from namche.sessions where token_hash=${digest(token)}`;jar.delete('namche_session');return Response.json({ok:true});}
