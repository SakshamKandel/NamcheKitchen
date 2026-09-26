import { sql } from '@/lib/db';
import { session,sameOrigin } from '@/lib/auth';
import { menuSchema } from '@/lib/validation';
import { randomUUID } from 'node:crypto';
export async function POST(request:Request){try{if(!sameOrigin(request)||!await session())return new Response(null,{status:401});const body=await request.json();const parsed=menuSchema.safeParse(body);if(!parsed.success)return Response.json({error:parsed.error.issues[0].message},{status:400});const data=parsed.data;const id=typeof body.id==='string'?body.id:randomUUID();if(data.image_id){const image=await sql`select id from namche.images where id=${data.image_id}`;if(!image.length)return Response.json({error:'Select an existing image.'},{status:400});}await sql`insert into namche.menu_items ${sql({id,...data})} on conflict(id) do update set ${sql({...data,updated_at:new Date()})}`;return Response.json({ok:true,id});}catch{return Response.json({error:'Unable to save this item. Please try again.'},{status:500});}}
