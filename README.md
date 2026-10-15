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

Server-only connection strings are in ignored `.env.local`. Set DATABASE_URL and DATABASE_URL_POOLED on the eventual web host; also set DATABASE_URL_UNPOOLED when the Neon branch pooler is disabled. The app prefers the direct URL when it is present. Never expose these as NEXT_PUBLIC variables. The application requires TLS to Postgres.

Database tables are isolated in the `namche` schema. `npm run db:seed` creates schema and imports the final attached food/beverage menus and supplied photos. `node --env-file=.env.local scripts/reviews.mjs` imports the five supplied reviews. Both imports preserve existing rows and do not overwrite staff edits. Original source files remain in the workspace. No other storage provider is used.

For an existing installation, run `npm run db:migrate` before deploying reservation availability changes. This applies the idempotent SQL files in `scripts/migrations/` using `DATABASE_URL_UNPOOLED` (or a direct `DATABASE_URL`). It creates the closed-date table without reseeding content or closing any dates.

## Staff

Open `/admin`. Initial credentials are in the ignored `.credentials/admin.txt` file. Change the password in the Security tab after handoff. Passwords use salted scrypt; session tokens are random, hashed in the database, and stored in HTTP-only SameSite=Strict cookies (Secure in production). Sessions expire after eight hours. Password changes invalidate all sessions.

Staff can add/edit menu entries, change prices/descriptions/categories, upload or reuse photos, hide unavailable items, choose homepage features, and review/update reservation requests. The homepage displays the first four featured available food items in display order. Uploads are limited to 5 MB JPG/PNG/WebP and re-encoded as WebP before storage in Neon.

To stop new reservations for a full day, open **Reservations → Reservation availability**, select a date, optionally add a staff-only note, and click **Close this date**. Both signed-in admins and owners have access through the existing staff login. Use **Reopen date** to accept requests again. The public form and guest assistant respect the same dates, including requests submitted from an older open page. Dates follow Ottawa local time and the six-month booking window. Existing requests are retained; the panel shows how many pending or confirmed reservations need staff attention. Closing or reopening a day does not contact guests or change existing reservation statuses.

The public site includes a Groq guest assistant that can answer read-only menu questions and submit reservation requests after the guest explicitly confirms the details. The `/admin` dashboard includes a private owner assistant that tries OpenRouter free models first and falls back to Groq. It can inspect menu items and reservation requests, prepare menu edits, change visibility, and attach uploaded food images; the server requires the signed-in owner session and a signed proposal confirmation button before any mutation. Configure the server-only `GROQ_API_KEY` (required for the public chatbot), `OPENROUTER_API_KEY` (used by the owner assistant), `AI_CONFIRMATION_SECRET`, and optional comma-separated model fallback lists from `.env.example`. Never expose these values through a `NEXT_PUBLIC_` variable.

Bookings begin as pending. Staff must contact the guest directly before confirming a table. When SMTP is configured, new requests and status changes send the existing reservation emails. Closing or reopening dates does not send email. All requested times are Ottawa local time. Opening hours have not been supplied; the site asks guests to call for hours and does not promise availability.

All order actions link to https://online.namchekitchen.ca/. This website does not collect payments or process orders. Beverage prices absent from the source document display “Ask your server”. The supplied Google reviews are curated excerpts with expandable full text, not a live feed or aggregate rating.

## Validation

`npm run build` checks compilation and TypeScript. With the local server running, `npm test` tests real Neon persistence, staff access control, CSRF origin checks, upload, menu editing, booking creation, status updates, and logout. Tests create uniquely identified temporary records and remove them in a finally block. `tests/visual.mjs` captures desktop/mobile screenshots and checks route/image loading and overflow.

Run `node --test tests/reservation-dates.test.mjs tests/public-chat-context.test.mjs` for pure date and chatbot-context checks without database access. The reservation closure integration test requires an isolated database/server, SMTP disabled, `TEST_BASE_URL`, test staff credentials (`TEST_ADMIN_USERNAME` / `TEST_ADMIN_PASSWORD`), and `TEST_ALLOW_DATABASE_WRITES=isolated-reservation-tests`. The admin browser check in `tests/reservation-availability-ui.mjs` uses test staff credentials and mocks closure mutations; run it against the test server with installed Chrome.

## Sources

Food baseline: NAMCHE FINAL MENU SEPT 20.doc, extracted to Menus/source-menu-verified.txt. Beverage baseline: Beverage for website.doc, extracted to Menus/source-beverages.txt. The user's seven food updates override the documents, including Chicken Khaja Set at $28. The older Menus/source-menu.txt is not the import source. Photos lacking a corresponding item in the final menu are retained in Neon for staff reuse without inventing new menu entries.
