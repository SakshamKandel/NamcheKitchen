# Namche Kitchen

Next.js 16 / React 19 / Node.js restaurant website. Neon Postgres is the only persistent store: menu items, image bytes, selected Google reviews, staff accounts, sessions, reservation requests, and rate limits.

## Run

```sh
npm install
npm run dev
```

The development site opens at http://localhost:3000. Production: `npm run build` then `npm start`.

## Neon

Linked project: `falling-tooth-21755546`, branch `production`. `neon.ts` contains the requested empty `defineConfig({})` policy. `neon deploy` applies Neon backend configuration; it does not host the Next.js website. The current website must run on a Node.js-compatible web host to have a public URL.

Server-only connection strings are in ignored `.env.local`. Set DATABASE_URL and DATABASE_URL_POOLED on the eventual web host. Never expose these as NEXT_PUBLIC variables. The application requires TLS to Postgres.

Database tables are isolated in the `namche` schema. `npm run db:seed` creates schema and imports the final attached food/beverage menus and supplied photos. `node --env-file=.env.local scripts/reviews.mjs` imports the five supplied reviews. Both imports preserve existing rows and do not overwrite staff edits. Original source files remain in the workspace. No other storage provider is used.

## Staff

Open `/admin`. Initial credentials are in the ignored `.credentials/admin.txt` file. Change the password in the Security tab after handoff. Passwords use salted scrypt; session tokens are random, hashed in the database, and stored in HTTP-only SameSite=Strict cookies (Secure in production). Sessions expire after eight hours. Password changes invalidate all sessions.

Staff can add/edit menu entries, change prices/descriptions/categories, upload or reuse photos, hide unavailable items, choose homepage features, and review/update reservation requests. The homepage displays the first four featured available food items in display order. Uploads are limited to 5 MB JPG/PNG/WebP and re-encoded as WebP before storage in Neon.

Bookings begin as pending. Staff must contact the guest directly before confirming a table. No email or SMS is sent automatically. All requested times are Ottawa local time. Opening hours have not been supplied; the site asks guests to call for hours and does not promise availability.

All order actions link to https://online.namchekitchen.ca/. This website does not collect payments or process orders. Beverage prices absent from the source document display “Ask your server”. The supplied Google reviews are curated excerpts with expandable full text, not a live feed or aggregate rating.

## Validation

`npm run build` checks compilation and TypeScript. With the local server running, `npm test` tests real Neon persistence, staff access control, CSRF origin checks, upload, menu editing, booking creation, status updates, and logout. Tests create uniquely identified temporary records and remove them in a finally block. `tests/visual.mjs` captures desktop/mobile screenshots and checks route/image loading and overflow.

## Sources

Food baseline: NAMCHE FINAL MENU SEPT 20.doc, extracted to Menus/source-menu-verified.txt. Beverage baseline: Beverage for website.doc, extracted to Menus/source-beverages.txt. The user's seven food updates override the documents, including Chicken Khaja Set at $28. The older Menus/source-menu.txt is not the import source. Photos lacking a corresponding item in the final menu are retained in Neon for staff reuse without inventing new menu entries.
