# Crisp Clean Marine

Boat cleaning operations app with three roles, chosen on the start screen.

## Roles

- **Manager (`/manager`)**: marinas with gates (codes and change history) and docks; crews and technicians; services with photo shot lists; customers with contacts, boats and recurring plans (fixed or seasonal frequency); a day and week schedule grouped by crew with bulk assign, move and cancel; weather days; a reschedule queue; flagged issues with customer notes, quotes and visibility; customer requests and sign-ups; billing CSV export; an activity log.
- **Technician (`/crew`)**: signs in by name with the crew passcode and sees today's and tomorrow's jobs for their crew in walking order, with gate code and access notes. Takes before photos per angle, starts the job, takes after photos guided by the matching before photo, finishes with a preset customer message, skips with a reason, or flags an issue. Works without signal: everything queues on the phone and uploads when signal returns. Add it to the home screen.
- **Customer**: a private boat page (`/portal/<link>`) with schedule, history, before and after photos (`/j/<link>`), flagged issues with quotes, and forms to order add-on services or pause cleanings. New customers sign up at `/signup`; the manager reviews and activates them.

Marina, dock and slip are required for boats in a slip. A gate is required when the marina has gates, unless the dock already has one.

## Messaging

Texts and email to customers and prospects, with templates, an approval queue, two-way conversations and exports.
Payments and social media posting are not in this app.

**Providers are swappable.** `lib/messaging/providers.ts` holds two small interfaces. Nothing else in the app names a vendor.

| Setting | Values | Notes |
| --- | --- | --- |
| `SMS_PROVIDER` | `test` (default), `twilio`, `http` | `test` records messages and sends nothing |
| `EMAIL_PROVIDER` | `test` (default), `resend`, `http` | |
| `BUSINESS_ADDRESS` | Postal address | Required before any marketing email will send |
| `APP_URL` | `https://your-domain` | Used in links and provider callbacks. Defaults to the Vercel production address |
| `EMAIL_FROM`, `EMAIL_REPLY_TO` | Addresses | Replies to email go to `EMAIL_REPLY_TO`, not into the app, unless the `http` option posts them back |
| `SMS_FROM` | Your sending number | |
| `CRON_SECRET` | Any long random value | Protects the daily job at `/api/cron` |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` (or `SMS_FROM`) | Point the number's incoming-message webhook at `/api/messaging/inbound/twilio` |
| Resend | `RESEND_API_KEY` | |
| `http` option | `SMS_HTTP_URL`, `SMS_HTTP_TOKEN`, `EMAIL_HTTP_URL`, `EMAIL_HTTP_TOKEN`, `MESSAGING_INBOUND_SECRET` | Vendor-free: the app posts JSON to your address; replies are posted to `/api/messaging/inbound/http` with `Authorization: Bearer <MESSAGING_INBOUND_SECRET>` as `{from, to, body, id}` |

The Twilio and Resend adapters follow those services' published interfaces but have not been run against live accounts. Send a test to your own phone and inbox before relying on them.

**Rules enforced in code** (`lib/messaging/compliance.ts`, checked when a message is created and again when it is sent):

- Service texts need recorded consent to texts. Marketing texts need separate written consent. Having a phone number is not consent.
- STOP, similar words and plain-language requests opt the number out immediately, cancel anything waiting, and add it to a do-not-text list that survives deleting and re-adding the person. Only the customer can undo it (START).
- No texts from 9 pm to 8 am Pacific; they wait until 8 am. A typed reply within an hour of the customer's own text is the exception.
- Every text names the business. The first text to a number and every marketing text say how to opt out.
- Consent belongs to a phone number: changing a customer's number clears their text permissions.
- Marketing email carries the postal address and an unsubscribe link, and honors unsubscribes at once.
- Every grant and withdrawal of consent is recorded with wording, method, time and who recorded it.

This is an engineering implementation of the US rules (TCPA, the FCC's orders, the carriers' CTIA principles, CAN-SPAM). It is not legal advice. Have counsel review the consent wording and `/sms-terms` before sending marketing texts. US carriers also require the business and its message types to be registered (A2P 10DLC) through whichever provider you choose; unregistered texts are filtered.

**Daily job.** `vercel.json` schedules `/api/cron` once a day (17:00 UTC, 9 am Pacific standard time) to queue next-day reminders and deliver anything waiting. Opening the manager pages does the same work, so a missed run is caught up.

## Settings (Vercel → Project → Settings → Environment Variables)

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection. Set automatically when the Neon database is connected |
| `BLOB_READ_WRITE_TOKEN` | Yes | Photo storage. Set automatically when the Blob store is connected |
| `APP_PASSCODE` | Yes | Technician passcode |
| `MANAGER_PASSCODE` | Strongly recommended | Manager passcode. Without it, technicians can open the manager pages with their passcode |
| `MANAGER_PHONE` | Optional | Shown to technicians on urgent flags as a tap-to-call number |
| `SESSION_SECRET` | Optional | Signs sign-in cookies. Defaults to a value derived from the passcodes; changing a passcode signs everyone out |
| `BUSINESS_NAME` | Optional | Defaults to Crisp Clean Marine |
| `INSTAGRAM_HANDLE` | Optional | Added to share captions |

## Limits on the free plans

Vercel Hobby is for non-commercial use. Blob on Hobby allows about 2,000 uploads a month: each photo is one upload, so roughly 150 to 250 jobs a month. Neon's free plan allows 0.5 GB of data, which is far more than this app needs. Move to Vercel Pro before relying on it for paying customers.

## Local development

```
npm install
npm run dev
```

With no `DATABASE_URL`, the app runs an embedded Postgres in `.data/pg` and stores photos in `.data/files`.

## Tests

- `npm test`: scheduling, database and messaging-rule tests.
- `npm run build && npm run test:e2e`: starts the built app on a fresh local database and drives a manager, a technician phone and a customer phone through every flow, including offline work, deletes, sign-in lockout and access checks. Needs Playwright with Chromium.

## Sign-in rules

- Five wrong passcodes from one network address lock sign-in for that role for 10 minutes.
- If no passcode is set on the live site, nobody can sign in.
- Every manager page and action checks the manager sign-in itself. Keep that when adding pages: call `requireManager()` first.
- A technician can post work only to their own crew's jobs. Work on another crew's job from the last two days through tomorrow is accepted and marked for manager review, because a visit can be reassigned while a phone is offline.
