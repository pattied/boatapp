# Boat Photos

The minimum version of the boat cleaning photo app. A crew member opens the site, starts a job, adds before and after photos, and gets a private link to text the customer. The customer's page shows a before/after slider and a branded image they can share to Instagram or save.

## How it works

- **Start screen (`/`)**: sign in as Manager, Technician or Customer.
- **Technician page (`/crew`)**: technician passcode, new job (boat name and optional customer first name), and jobs started on this phone.
- **Job page (`/job/<id>`)**: before and after photos, taken with the camera or picked from the library. Each photo is shrunk on the phone to 2048 pixels on the long edge, which also strips location data, and uploads right away. Failed uploads show Retry. Tap a photo to star it for the share image. "Create share link" builds a 1080 × 1350 before-over-after image with the business name and Instagram handle, then offers Text link, Copy link and Share.
- **Manager page (`/manager`)**: every job from every phone, newest first. Search by boat or customer, and filter to today, the last 7 days, or jobs with no customer link yet. Each job shows its before and after photo counts, a status (No photos, No link yet, Link ready) and its last activity, with buttons to open the job, open the customer page, copy the link, or delete the job and its photos. It uses `MANAGER_PASSCODE` if set, otherwise the crew passcode.
- **Customer home (`/customer`)**: customers have no accounts yet, so the texted link is their key. Lists the cleanings opened on that phone and accepts a pasted link.
- **Customer photo page (`/j/<id>`)**: no login. The link uses 128 random bits, so it can't be guessed. It shows the share image, Share (the image file alone, which is what iPhones need for Instagram), Save image, Copy caption, Copy link, a drag-to-compare slider per before/after pair, and any extra photos. Text-message link previews use the share image.
- **Storage**: Vercel Blob. Files are never overwritten. Photos are served through `/p/...` on this site, so the Blob store can stay private and the CDN caches each photo once. With no Blob store and no Vercel environment, the app stores files in `.data/` for local testing.

## Blob usage limits

Each photo upload is one Blob "advanced operation", and so is each listing of a job's photos. The Hobby plan allows 2,000 advanced operations a month, and Blob stops working for the rest of the 30-day period once that is exceeded. To keep listings rare, the app caches each job's photo list in Vercel's data cache and expires it only when that job changes. A typical job costs about 12 advanced operations: the job record, about 8 photos, the share image, and a couple of listings. Hobby therefore covers roughly 150 jobs a month. Vercel's Hobby plan is also limited to non-commercial use, so move to Pro before crews use the app daily.

## Settings (Vercel → Project → Settings → Environment Variables)

| Variable | Required | Purpose |
| --- | --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Yes | Set automatically when a Blob store is connected to the project |
| `APP_PASSCODE` | Yes | Shared crew passcode. Without it, anyone with the site address can upload |
| `MANAGER_PASSCODE` | Optional | Separate passcode for `/manager`. Without it, the crew passcode opens the manager page |
| `BUSINESS_NAME` | Recommended | Shown on the customer page and in the share image |
| `INSTAGRAM_HANDLE` | Optional | Without the @. Burned into the share image and caption |
| `BLOB_ACCESS` | Only if the store is public | `private` (default) or `public`. Must match the Blob store's access setting |

Changing a variable takes effect after the next deploy.

## Add to the home screen

- **iPhone**: open the site in Safari, tap Share, then Add to Home Screen.
- **Android**: open it in Chrome, tap the menu, then Add to Home screen or Install app.

## Local development

```
npm install
npm run dev
```

Without a Blob token, files go to `.data/`.

## Not in this version

This version has no offline upload queue (photos need signal to upload), no scheduling, texting automation, reminders, customer portal or flagged issues. Those are in the build plan.
