# Boat Photos

The minimum version of the boat cleaning photo app. A crew member opens the site, starts a job, adds before and after photos, and gets a private link to text the customer. The customer's page shows a before/after slider and a branded image they can share to Instagram or save.

## How it works

- **Crew page (`/`)**: crew passcode, new job (boat name and optional customer first name), and jobs started on this phone.
- **Job page (`/job/<id>`)**: before and after photos, taken with the camera or picked from the library. Each photo is shrunk on the phone to 2048 pixels on the long edge, which also strips location data, and uploads right away. Failed uploads show Retry. Tap a photo to star it for the share image. "Create share link" builds a 1080 × 1350 before-over-after image with the business name and Instagram handle, then offers Text link, Copy link and Share.
- **Customer page (`/j/<id>`)**: no login. The link uses 128 random bits, so it can't be guessed. It shows the share image, Share (the image file alone, which is what iPhones need for Instagram), Save image, Copy caption, Copy link, a drag-to-compare slider per before/after pair, and any extra photos. Text-message link previews use the share image.
- **Storage**: Vercel Blob. Files are never overwritten. Photos are served through `/p/...` on this site, so the Blob store can stay private and the CDN caches each photo once. With no Blob store and no Vercel environment, the app stores files in `.data/` for local testing.

## Settings (Vercel → Project → Settings → Environment Variables)

| Variable | Required | Purpose |
| --- | --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Yes | Set automatically when a Blob store is connected to the project |
| `APP_PASSCODE` | Yes | Shared crew passcode. Without it, anyone with the site address can upload |
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
