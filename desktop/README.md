# Hotel Shamiyana PMS — Windows desktop demo

A Windows installer (`Shamiyana-PMS-Demo-Setup-<version>.exe`) that runs the whole
PMS on one computer: no internet hosting, no Docker, nothing for the client to
set up. It works for **10 days** from first launch. After that it stops and
asks for an activation key, which only QuantaFONS can issue.

## How it works

The web app runs on Supabase. Supabase is more than a database: it also
handles sign-in, the database API and file storage. So the installer ships
those pieces as ordinary Windows programs, at the versions Supabase's own
self-hosted stack uses:

```
Hotel Shamiyana PMS.exe  (Electron: the window + Node.js)
 ├─ licence check ─ expired → activation screen, nothing else starts
 ├─ PostgreSQL 17        127.0.0.1:54322   data in %LOCALAPPDATA%\Shamiyana\pgdata
 ├─ Supabase Auth        127.0.0.1:54324   sign-in, 2FA (built from source, patches/)
 ├─ PostgREST            127.0.0.1:54323   the database API
 ├─ gateway              127.0.0.1:54321   one address for all three + file storage (lib/gateway.js, lib/storage.js)
 ├─ Next.js server       127.0.0.1:54330   the app, shown in the window
 └─ daily jobs           what Vercel Cron does in production (lib/cron.js)
```

Everything listens on 127.0.0.1 only, so the services are unreachable from the
network and Windows Firewall never asks. The app code is unchanged apart from
two switches that only the desktop build turns on (`DEMO_BUILD=1`):
`next.config.ts` (standalone output, local room photos) and
`LiveRefresh.tsx` (refresh every 15 s, since there is no Realtime server).

On first launch the database is created and all `supabase/migrations` are
applied, after which the client creates the administrator account. An updated
installer applies only the new migrations and keeps the data.

## Building the installer

Build on **GitHub Actions**, which runs on Windows:

1. Push the `exe-compile` branch. Every push starts a build. Once the workflow
   is merged to `master`, it can also be started by hand from **Actions →
   Windows demo installer → Run workflow**.
2. After ~15 minutes, download **Shamiyana-PMS-Demo-Setup** from the run's
   *Artifacts* section (a zip containing the `.exe`).

The workflow also starts the whole stack on Windows and checks sign-in, the
database API, storage permissions and the app pages before building. If that
smoke test fails, no installer is produced.

Optional repository secrets (*Settings → Secrets and variables → Actions*):
`DEMO_RESEND_API_KEY`, `DEMO_NOTIFY_FROM_EMAIL`, `DEMO_TWILIO_*`,
`DEMO_RAZORPAY_KEY_ID`, `DEMO_RAZORPAY_KEY_SECRET`. Use **test** keys only,
because anyone who has the installer can read them. Set `DESKTOP_JWT_SECRET`
(any long random string) if you want staff to stay signed in across installer
updates.

### Running it on a Mac while developing

```sh
cd desktop
npm install
npm run stage                       # Postgres from /Library/PostgreSQL/18, PostgREST, Auth (needs Go), next build
ELECTRON_RUN_AS_NODE=1 npx electron scripts/smoke.js    # headless end-to-end check
node scripts/license-test.js        # trial and key rules
npx electron .                      # the real window (unset ELECTRON_RUN_AS_NODE first if VS Code set it)
```

## Before sending it to a client

- Fill in `contact.json` (email, phone). The "demo has ended" screen shows it.
- Install it on a Windows 10/11 PC or VM yourself first. Parallels or UTM work on a Mac.
- The installer is not code-signed. Windows SmartScreen will say *"Windows
  protected your PC"*; the client clicks **More info → Run anyway**. A
  code-signing certificate removes this.

## Activation keys

Keys are signed with a private key that only you hold. The app only contains
the matching public key (`license-public.pem`).

- **The private key** is at `~/.shamiyana-license/private.pem`. **Back it up.**
  If you lose it you can no longer issue keys for installers already out
  there. If someone else gets it, they can issue keys.
- When a client's demo ends they see a **Machine ID** (e.g. `7F3K-92QD-LX8M-W4TA`).
  Ask them for it, then:

```sh
node scripts/license/issue-key.mjs --machine 7F3K-92QD-LX8M-W4TA --until 2026-12-31 --customer "Hotel X"
node scripts/license/issue-key.mjs --machine 7F3K-92QD-LX8M-W4TA --permanent --customer "Hotel X"
```

Send them the printed `SHAM1.…` line. The key only works on that computer, and
`--until` keys stop at the end of that day.

### How the 10 days are enforced

- The trial start is stored in three places, each sealed to the machine:
  the registry (`HKCU\Software\QuantaFONS\Shamiyana`),
  `%ProgramData%\QuantaFONS\shamiyana.dat`, and the database. Uninstalling or
  reinstalling does not reset it, and deleting one copy is not enough.
- Setting the clock back is detected, and an internet time check is used when
  online.
- A valid key always wins, so a client who triggered a tamper check can still
  be activated.
- The main-process code is obfuscated and packed, with Electron's asar
  integrity check on. This stops a normal user, not a determined reverse
  engineer; no offline check can. The app's server code ships too, minified, as
  with any desktop app.

To **reset the trial on your own test machine**: uninstall, then delete
`%LOCALAPPDATA%\Shamiyana`, `%ProgramData%\QuantaFONS`, and the registry key
above.

## Known demo limitations

- **Razorpay:** payment links open and test payments go through, but Razorpay's
  webhook cannot reach a PC, so the folio is not marked paid automatically.
  Record the payment at the desk.
- **Email/SMS** only go out while the PC is online. Resend's test mode
  delivers only to your Resend account's own address. The guest portal also
  offers password sign-in for that reason.
- **Live updates** arrive within 15 seconds rather than instantly.
- Door locks, kitchen display, biometric attendance and in-room controls are
  not connected, as in any deployment without that hardware.
- Data lives on that one PC. Uninstalling keeps it.

## Troubleshooting

Logs are in `%LOCALAPPDATA%\Shamiyana\logs` (the error screen has an *Open log
folder* button): `postgres.log`, `gotrue.log`, `postgrest.log`, `next.log`,
`cron.log`. "Port … is already in use" means another program has one of the
ports above. Restarting the PC usually clears it.
