# Crisp Clean Marine

Boat cleaning operations app with three roles, chosen on the start screen.

## Roles

- **Manager (`/manager`)**: marinas with gates (codes and change history) and docks; crews and technicians; services with photo shot lists; customers with contacts, boats and recurring plans (fixed or seasonal frequency); a day and week schedule grouped by crew with bulk assign, move and cancel; weather days; a reschedule queue; flagged issues with customer notes, quotes and visibility; customer requests and sign-ups; billing CSV export; an activity log.
- **Technician (`/crew`)**: signs in by name with the crew passcode and sees today's and tomorrow's jobs for their crew in walking order, with gate code and access notes. Takes before photos per angle, starts the job, takes after photos guided by the matching before photo, finishes with a preset customer message, skips with a reason, or flags an issue. Works without signal: everything queues on the phone and uploads when signal returns. Add it to the home screen.
- **Customer**: a private boat page (`/portal/<link>`) with schedule, history, before and after photos (`/j/<link>`), flagged issues with quotes, and forms to order add-on services or pause cleanings. New customers sign up at `/signup`; the manager reviews and activates them.

Marina, dock and slip are required for boats in a slip. A gate is required when the marina has gates, unless the dock already has one.

## Not in this version

Text messages (reminders, YES/NO confirmations, photo links), social media posting and payments. Customer links are copied and sent by hand.

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

With no `DATABASE_URL`, the app runs an embedded Postgres in `.data/pg` and stores photos in `.data/files`. Tests: `npx tsx --test tests/*.test.ts`.
