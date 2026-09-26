import { sql } from '@/lib/db';
import { session,sameOrigin } from '@/lib/auth';
import { z } from 'zod';
export async function PATCH(request:Request){try{if(!sameOrigin(request)||!await session())return new Response(null,{status:401});const result=z.object({id:z.uuid(),status:z.enum(['pending','confirmed','cancelled','completed'])}).safeParse(await request.json());if(!result.success)return Response.json({error:'Invalid status.'},{status:400});const rows=await sql`update namche.reservations set status=${result.data.status} where id=${result.data.id} returning id`;return rows.length?Response.json({ok:true}):Response.json({error:'Request not found.'},{status:404});}catch{return Response.json({error:'Unable to update reservation.'},{status:500});}}
