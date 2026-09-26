import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import postgres from 'postgres';
const base=process.env.TEST_BASE_URL||'http://localhost:3000';
const sql=postgres(process.env.DATABASE_URL,{ssl:'require',max:1});
const request=(path,method='GET',body,cookie='',origin=base)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
test('Neon-backed admin, menu, images and reservations work with access controls',async()=>{
 const suffix=crypto.randomUUID();let bookingId;let menuId='test-'+suffix;let imageId;let cookie='';
 try {
  const publicAdmin=await request('/admin');assert.equal(publicAdmin.status,200);assert.match(await publicAdmin.text(),/Sign in/);
  const denied=await request('/api/admin/menu','POST',{});assert.equal(denied.status,401);
  const crossOrigin=await request('/api/reservations','POST',{},'','https://untrusted.example');assert.equal(crossOrigin.status,403);
  const invalid=await request('/api/reservations','POST',{name:'Test',email:'test@example.com',phone:'6137611616',date:'2026-02-31',time:'18:00',guests:2});assert.equal(invalid.status,400);
  const password=(await fs.readFile('.credentials/admin.txt','utf8')).match(/Password: (.+)/)[1];
  const login=await request('/api/admin/login','POST',{username:'admin',password});assert.equal(login.status,200);const setCookie=login.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/i);assert.match(setCookie,/SameSite=strict/i);cookie=setCookie.split(';')[0];
  const image=await request('/api/images/restaurant');assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/webp');assert.ok((await image.arrayBuffer()).byteLength>1000);
  const [asset]=await sql`select data from namche.images where id='review-bibek-nepal'`;const form=new FormData();form.set('image',new Blob([asset.data],{type:'image/webp'}),'test.webp');const upload=await fetch(base+'/api/admin/upload',{method:'POST',headers:{Origin:base,Cookie:cookie},body:form});assert.equal(upload.status,200);imageId=(await upload.json()).id;
  const item={id:menuId,name:'Integration test item',description:'Temporary verification record',kind:'food',category:'Test',price:11,price_note:'',image_id:imageId,available:false,featured:false,sort_order:9999};
  assert.equal((await request('/api/admin/menu','POST',item,cookie)).status,200);
  item.price=12.5;assert.equal((await request('/api/admin/menu','POST',item,cookie)).status,200);
  const [saved]=await sql`select * from namche.menu_items where id=${menuId}`;assert.equal(Number(saved.price),12.5);assert.equal(saved.image_id,imageId);
  const menu=await request('/menu');assert.equal(menu.status,200);const html=await menu.text();assert.ok(!html.includes('Integration test item'));assert.match(html,/Chicken Khaja Set/);
  const date=new Date(Date.now()+7*86400000).toISOString().slice(0,10);const email='qa-'+suffix+'@example.com';const booking=await request('/api/reservations','POST',{name:'Website QA Test',email,phone:'6137611616',date,time:'18:00',guests:2,notes:'Temporary automated verification record',website:''});assert.equal(booking.status,201);bookingId=(await booking.json()).id;
  const [row]=await sql`select * from namche.reservations where id=${bookingId}`;assert.equal(row.status,'pending');assert.equal(row.email,email);
  assert.equal((await request('/api/admin/reservations','PATCH',{id:bookingId,status:'confirmed'},cookie)).status,200);
  const [confirmed]=await sql`select status from namche.reservations where id=${bookingId}`;assert.equal(confirmed.status,'confirmed');
  const admin=await request('/admin','GET',undefined,cookie);assert.match(await admin.text(),/Website QA Test/);
  assert.equal((await request('/api/admin/logout','POST',undefined,cookie)).status,200);
  assert.equal((await request('/api/admin/menu','POST',item,cookie)).status,401);
  const [counts]=await sql`select (select count(*) from namche.menu_items where kind='food' and id<>${menuId})::int food,(select count(*) from namche.menu_items where kind='drink')::int drinks,(select count(*) from namche.reviews)::int reviews`;
  assert.equal(counts.food,46);assert.equal(counts.drinks,33);assert.equal(counts.reviews,5);
 }finally{if(bookingId)await sql`delete from namche.reservations where id=${bookingId}`;await sql`delete from namche.menu_items where id=${menuId}`;if(imageId)await sql`delete from namche.images where id=${imageId}`;await sql.end();}
});
