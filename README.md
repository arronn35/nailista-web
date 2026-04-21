# Nailista Website + Firebase Waitlist Backend

## What this setup does

- Serves the static site through Firebase Hosting.
- Exposes `POST /api/submitWaitlist` via Cloud Functions v2.
- Exposes `POST /api/admin/waitlist` for filtered admin listing.
- Stores waitlist leads in Firestore with dedup by email hash.
- Applies a short per-IP rate limit (5 requests/minute).
- Redirects `/privacy` and `/privacy/` to `privacy.html`.
- Redirects `/admin` and `/admin/` to `admin.html`.
- Uses a custom `404.html` for unknown routes.

## Firestore collections

- `waitlist/{emailKey}`
- `waitlist_rate_limits/{ipHash}`

## 1) Configure project ID

Edit `.firebaserc`:

```json
{
  "projects": {
    "default": "your-firebase-project-id"
  }
}
```

## 2) Install dependencies

```bash
cd functions
npm install
```

## 3) Configure admin panel token

Create `functions/.env` from `functions/.env.example`:

```bash
cp functions/.env.example functions/.env
```

Then set a strong value:

```env
WAITLIST_ADMIN_TOKEN=your-long-random-token
```

## 4) Local emulator run

From repository root:

```bash
firebase emulators:start --only functions,firestore,hosting
```

The frontend calls `POST /api/submitWaitlist`, so it will work through Hosting emulator.

Optional smoke check (while emulators run):

```bash
./scripts/smoke-waitlist.sh
```

## 5) Deploy

From repository root:

```bash
firebase deploy --only functions,hosting,firestore:rules,firestore:indexes
```

## API contract

### Request

`POST /api/submitWaitlist`

```json
{
  "email": "name@example.com",
  "sourceForm": "hero",
  "utm": {
    "source": "instagram",
    "medium": "social",
    "campaign": "launch"
  }
}
```

### Response

```json
{
  "success": true,
  "status": "created",
  "message": "You are on the waitlist."
}
```

Possible `status` values:

- `created`
- `already_exists`
- `rate_limited`
- `invalid`

### Admin list API

`POST /api/admin/waitlist`

Headers:

- `Authorization: Bearer <WAITLIST_ADMIN_TOKEN>` or `X-Admin-Token: <token>`

Request body (all fields optional):

```json
{
  "sourceForm": "hero",
  "emailQuery": "example@",
  "fromDate": "2026-04-01T00:00:00.000Z",
  "toDate": "2026-04-30T23:59:59.999Z",
  "limit": 50
}
```

Admin panel route:

- `/admin` (served from `admin.html`)
- If Hosting is disabled, open `admin.html` locally and set the "Admin API URL" field to your deployed `listWaitlistEntries` function URL.
