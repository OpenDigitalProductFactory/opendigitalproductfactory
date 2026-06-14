# DPF Mobile — Privacy Policy (DRAFT)

**Status:** DRAFT for review — not legal advice. Have counsel review before
publishing. Host the final version at a public HTTPS URL and reference it in the
Apple App Store and Google Play listings (both require a privacy policy URL) and
in the app's sign-in flow. Supports BI-MOBAPP-ACCOUNTS (store metadata).

Publisher: **Arcamanus LLC** ("we", "us"). The DPF Mobile app is a generic
client that connects to a self-hosted Digital Product Factory ("DPF") install
operated by your organization ("the install operator"). **Your organization's
DPF install is the controller of your data; we operate the app, not your data.**

---

## What the app handles

- **Account authentication.** When you connect to your organization's install
  and sign in, the app exchanges your credentials for access/refresh tokens.
  Tokens are stored in the device's secure storage (Keychain / Keystore) and are
  used only to authenticate requests to *your* install. We do not receive them.
- **The install address you enter.** The app stores the install URL you connect
  to on the device so it can reconnect. It is not transmitted to us.
- **Push notification token.** If you enable notifications, the device's push
  token is registered with your install so it can send you notifications (e.g. a
  new field job, an approval request). Delivery is routed via Apple (APNs) and
  Google (FCM) and the Expo push service. Push payloads carry only safe summary
  text and a deep link — **not** sensitive record content.
- **Operational data you view/enter.** Jobs, schedules, customer records,
  invoices, messages, photos/signatures, and location you capture for a job are
  sent to and stored by *your organization's install*, per its configuration and
  retention rules — not by us.
- **Offline queue.** Actions you take offline (e.g. a job check-in) are stored on
  the device until connectivity returns, then sent to your install.

## What we (Arcamanus LLC) collect

By default, **nothing**. The app talks directly to your organization's install.
We do not operate a central server that receives your data, and the app contains
no third-party analytics or advertising SDKs. Crash/diagnostic reporting, if ever
added, will be disclosed here and made opt-in.

## Device permissions

Requested only when a feature needs them, and you may decline:
- **Camera** — to attach photos to a job.
- **Location** — to capture a job site location / check-in.
- **Notifications** — to receive push notifications.
- **Biometrics** — to unlock stored credentials on the device.

## Data sharing

We do not sell or share your data. Data flows between your device and your
organization's install. Apple and Google process push notifications as
infrastructure providers when notifications are enabled.

## Data retention & deletion

Operational data is retained and deleted by your organization's install per its
policies — contact your install operator for access/correction/deletion.
On-device data (tokens, install URL, offline queue) is removed when you sign out
or uninstall the app.

## Children

The app is a workplace tool and is not directed to children under 13 (or the
applicable age in your jurisdiction).

## Contact

Questions about the app: **[support email — TBD]**. Questions about your data:
your organization's DPF install operator.

## Changes

We will update this policy as needed and revise the date below.

_Last updated: [DATE — TBD]_
