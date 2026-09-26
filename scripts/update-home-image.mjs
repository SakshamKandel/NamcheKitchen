import postgres from 'postgres';
import sharp from 'sharp';
const sql=postgres(process.env.DATABASE_URL,{ssl:'require',max:1});
try {
 const bytes=await sharp('Outdoor Image.png').rotate().resize({width:2400,withoutEnlargement:true}).webp({quality:88}).toBuffer();
 await sql.begin(async tx=>{
  await tx`insert into namche.images(id,mime,data) values('restaurant-outdoor-v2','image/webp',${bytes}) on conflict(id) do nothing`;
  await tx`update namche.site_content set value=jsonb_set(value,'{hero_image_id}','"restaurant-outdoor-v2"'::jsonb),updated_at=now() where key='restaurant'`;
 });
 console.log('Homepage outdoor image saved in Neon and site content updated.');
}finally{await sql.end();}
