import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const base=process.env.TEST_BASE_URL||'http://localhost:3001';
await fs.mkdir('test-results',{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const errors=[];
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',e=>errors.push(e.message));
for(const route of ['/','/menu','/drinks','/about','/catering','/visit','/reservations','/admin']){
 const response=await page.goto(base+route,{waitUntil:'networkidle'});if(response.status()!==200)throw new Error(`${route}: ${response.status()}`);
 await page.evaluate(async()=>{await Promise.all([...document.images].map(img=>{if(img.loading==='lazy')img.loading='eager';return img.decode().catch(()=>{});}));});
 const broken=await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>!i.complete||!i.naturalWidth).map(i=>i.src));if(broken.length)errors.push(`${route} broken images: ${broken}`);
 await page.screenshot({path:`test-results/desktop-${route==='/'?'home':route.slice(1)}.png`,fullPage:true});
}
await page.goto(base+'/menu',{waitUntil:'networkidle'});await page.getByRole('button',{name:'Nepali Momo',exact:true}).click();if(await page.locator('.menu-card').count()!==4)errors.push('Momo filter failed');await page.getByRole('searchbox').fill('does not exist');if(!await page.getByText('No matches yet.').isVisible())errors.push('Empty search state failed');
await page.goto(base+'/',{waitUntil:'networkidle'});if(await page.locator('.review-card').count()!==5)errors.push('Missing reviews');await page.getByText('Read full review',{exact:true}).first().click();if(!await page.getByText('Loved Namche!',{exact:false}).isVisible())errors.push('Review expansion failed');
await page.setViewportSize({width:390,height:844});
for(const route of ['/','/menu','/drinks','/reservations','/visit']){await page.goto(base+route,{waitUntil:'networkidle'});await page.evaluate(async()=>{for(const img of document.images)img.loading='eager';await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)errors.push(`${route} mobile overflow`);await page.screenshot({path:`test-results/mobile-${route==='/'?'home':route.slice(1)}.png`,fullPage:true});}
await page.getByRole('button',{name:'Open navigation'}).click();await page.getByRole('navigation').getByRole('link',{name:'Our menu'}).click();await page.waitForURL('**/menu');
await browser.close();
if(errors.length)throw new Error(errors.join('\n'));
console.log('Desktop/mobile routes, images, navigation, menu filters and review expansion passed.');
