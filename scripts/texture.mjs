import postgres from 'postgres';
import sharp from 'sharp';
const sql=postgres(process.env.DATABASE_URL,{ssl:'require',max:1});
try{const bytes=await sharp('assets/himalayan-paper.png').resize(1200).webp({quality:85}).toBuffer();await sql`insert into namche.images(id,mime,data) values('himalayan-paper-v1','image/webp',${bytes}) on conflict(id) do nothing`;console.log('Ornamental paper texture saved to Neon.');}finally{await sql.end();}
