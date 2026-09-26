import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import postgres from 'postgres';
import sharp from 'sharp';
const sql=postgres(process.env.DATABASE_URL,{ssl:'require',max:2});
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
try {
 await sql.unsafe(await fs.readFile('scripts/schema.sql','utf8'));
 const assets={};
 for(const folder of ['Menus','Chef']) for(const file of await fs.readdir(folder)) {
  if(!/\.(jpe?g|png)$/i.test(file)||file.includes('contact-sheet')) continue;
  const id=folder==='Chef'?'chef':slug(file.replace(/\.[^.]+$/,''));
  const bytes=await sharp(path.join(folder,file)).rotate().resize({width:1400,withoutEnlargement:true}).webp({quality:85}).toBuffer();
  await sql`insert into namche.images(id,mime,data) values(${id},'image/webp',${bytes}) on conflict(id) do nothing`;
  assets[file]=id;
 }
 for(const [file,id] of [['Logo without BG.png','logo'],['Outdoor Restaurant Phots.jpg','restaurant']]) {
  const bytes=await sharp(file).rotate().resize({width:1600,withoutEnlargement:true}).webp({quality:88}).toBuffer();
  await sql`insert into namche.images(id,mime,data) values(${id},'image/webp',${bytes}) on conflict(id) do nothing`;
 }
 const mappings=[['Spring Roll','Spring Rolls.jpeg'],['Chicken Wings','Chicken Wings.jpeg'],['Garlic Shrimp','Shrimp.jpeg'],['Samosa','Samosa.jpeg'],['Beet Root','Beet Root Salad.jpeg'],['Caesar','Ceasar Salad.jpeg'],['Lentil','Daal.jpeg'],['Hot & Sour','hot and sour soup.jpeg'],['Sukuti','sukuti Sadeko.jpeg'],['Chicken Sadeko','Chicken Sadeko.jpeg'],['Khaja','Chicken Khaja set.jpeg'],['Thukpa','Thupka.jpeg'],['Kothey','Kothe MOMO All Category, Chicken Veg, Buff.jpeg'],['Jhol','ALL Momo\'s Jhol Momo Category Momo Image.jpeg'],['Chilli Momo','All Category Chilli Momo Veg, Buff, Chicken.jpeg'],['Chicken Curry','Chicken Curry.jpeg'],['Mutton','Goat Curry.jpeg'],['Butter Chicken','Butter chicken.jpeg'],['Butter Paneer','butter panner.jpeg'],['Biryani','Chicken Dum Briyani.jpeg'],['Salmon','Himalayn Timur Salmon.jpeg'],['Risotto','Wild Mushroom Risotto.jpeg'],['Jalfrezi','Paneer Jalfrezi.jpeg'],['Fried Rice','Fried Rice.jpeg'],['Hakka','Chicken Chowmin.jpeg'],['Momo and Noodle','Momo Combo.jpeg']];
 const lines=(await fs.readFile('Menus/source-menu-verified.txt','utf8')).split(/[\r\n\v\f]+/).map(s=>s.trim()).filter(Boolean);
 let category='',items=[];
 for(let i=0;i<lines.length;i++) {
  const line=lines[i]; if(line.startsWith('—')) {category=line.replace(/—/g,'').trim().toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());continue;}
  if(line.includes('NAMCHE CATERING'))break;
  if(!line.includes('$')||line.startsWith('Choice of'))continue;
  let name=line.slice(0,line.indexOf('$')).trim(),price=Number(line.match(/\$(\d+)/)?.[1]),note='';
  if(line.startsWith('Fried Rice')){name='Fried Rice';note='Veg $16 · Chicken $18 · Egg $18';}
  if(line.startsWith('Namche Hakka')){name='Namche Hakka Noodle';note='Veg $16 · Chicken $17';}
  if(line.startsWith('Poutine')){name='Poutine (Large)';note='Veg $13 · Chicken $15';}
  if(category==='Nepali Momo')note='Vegetable or chicken · Buffalo +$2';
  if(name.startsWith('Chicken Khaja')){name='Chicken Khaja Set (Traditional Nepali Meal Platter)';price=28;}
  if(name==='Chatpate')name='Chatpate (Nepali Street Food Snack)';
  if(name.startsWith('Thukpa'))name='Thukpa (Veg / Chicken) — Himalayan Noodle Soup';
  const description=(lines[i+1]||'').replace('French fries fries','French fries');
  const mapping=mappings.find(([key])=>name.includes(key));
  items.push({id:slug(name),name,description,category,kind:'food',price,price_note:note,image_id:mapping?assets[mapping[1]]:null,featured:['Jhol Momo','Chicken Khaja Set','Mutton (Goat) Curry','Sukuti Sadeko'].some(s=>name.startsWith(s)),sort_order:items.length});
 }
 const drinkLines=(await fs.readFile('Menus/source-beverages.txt','utf8')).split(/[\r\n\v]+/).map(s=>s.trim()).filter(Boolean);
 const drinkSections={'HOT DRINKS':'Hot Drinks & Traditional Teas','ZERO-PROOF':'Zero-Proof Mocktails','SIGNATURE HIMALAYAN':'Himalayan Cocktails','DOMESTIC, LOCAL':'Beers','WINE SELECTION':'Wines','FINE SPIRITS':'Spirits & Digestifs'};
 const addDrink=(name,description='',price=null,category='Cold Drinks & Juice',note='Dine-in only')=>items.push({id:'drink-'+slug(name),name,description,category,kind:'drink',price,price_note:note,image_id:null,featured:false,sort_order:items.length});
 addDrink('Chilled Canned Beverages & Water','',3,'Cold Drinks & Juice','');addDrink('Seasonal Juice','',5,'Cold Drinks & Juice','');
 let drinkCategory='';
 for(let i=0;i<drinkLines.length;i++) {
  const line=drinkLines[i],section=Object.keys(drinkSections).find(k=>line.startsWith(k));
  if(section){drinkCategory=drinkSections[section];continue;}
  if(!drinkCategory||line==='ALCOHOLIC BEVERAGE'||line.startsWith('★'))continue;
  if(drinkCategory==='Wines'||drinkCategory==='Spirits & Digestifs') {addDrink(line,'',null,drinkCategory);continue;}
  const next=drinkLines[i+1]||''; let description=next; i++;
  if((drinkLines[i+1]||'').startsWith('★'))description+=' '+drinkLines[++i];
  addDrink(line,description,null,drinkCategory);
 }
 for(const item of items)await sql`insert into namche.menu_items ${sql(item)} on conflict(id) do nothing`;
 const existing=await sql`select id from namche.admins where username='admin'`;
 if(!existing.length){
  const password=crypto.randomBytes(18).toString('base64url');const salt=crypto.randomBytes(16).toString('hex');
  const hash=salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
  await sql`insert into namche.admins(id,username,password_hash) values('owner','admin',${hash})`;
  await fs.mkdir('.credentials',{recursive:true});await fs.writeFile('.credentials/admin.txt',`Namche Kitchen administration\nLogin: /admin\nUsername: admin\nPassword: ${password}\n\nChange this password from the admin dashboard. Keep this file private.\n`);
 }
 console.log(`Seed complete: ${items.filter(x=>x.kind==='food').length} food items, ${items.filter(x=>x.kind==='drink').length} beverages. Images stored in Neon. Admin credentials saved privately.`);
} finally {await sql.end();}
