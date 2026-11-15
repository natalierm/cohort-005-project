# Reaching people on their phones without a native app

Research for [#5](https://github.com/natalierm/cohort-005-project/issues/5). Researched November 2026. Prices change, so re-check the linked pages before you rely on a number.

**Question:** Cadence is web-only (React Router 8 framework mode, SQLite through Drizzle, a Node server). Transactional email already goes out through Postmark in `app/lib/mailer.server.ts`. Without building a native app, how can a **Notification** reach someone's phone? This note covers three **Channels**: Web Push to an installed PWA, SMS, and email. Native apps are out of scope.

Terms: "push subscription" means the browser's `PushSubscription` object (endpoint plus keys). It is not the same thing as a **Notification Preference** (see `GLOSSARY.md`).

---

## 1. Web Push (Push API + service worker + VAPID)

### How it works

- Three standards work together: the Push API, the Notifications API, and Service Workers. [WebKit: Meet Web Push](https://webkit.org/blog/12945/meet-web-push/)
- The app needs an active service worker. The worker calls `PushManager.subscribe()`, which returns a `PushSubscription`. That object holds "an endpoint and the encryption key needed for sending data". [MDN: Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- The endpoint is a secret capability URL: anyone who knows it can push to the app. MDN also warns that you must protect the subscribe flow against CSRF. [MDN: Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- To send, the server makes an HTTP POST to the endpoint using the Web Push Protocol ([RFC 8030](https://www.rfc-editor.org/rfc/rfc8030)). The server identifies itself with a VAPID-signed JWT (ES256). The JWT's `exp` must be no more than 24 hours ahead, and `sub` must be a `mailto:` address or a URL. [web.dev: Web Push Protocol](https://web.dev/articles/push-notifications-web-push-protocol)
- The payload is encrypted end-to-end with `aes128gcm` ([RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.html)). This means the push service (FCM, Mozilla autopush, APNs) cannot read it.
- Every push must show a visible notification. WebKit requires `userVisibleOnly: true` and says that "Violations of the `userVisibleOnly` promise will result in a push subscription being revoked." [WebKit: Meet Web Push](https://webkit.org/blog/12945/meet-web-push/)

### Platform support

| Platform | Support | Source |
| --- | --- | --- |
| All major browsers (Push API) | MDN Baseline "Widely available" since March 2023 | [MDN: Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) |
| Android (Chrome and other Chromium browsers) | Works in the browser. No home-screen install needed. Chrome delivers through FCM | [web.dev: subscribing a user](https://web.dev/articles/push-notifications-subscribing-a-user), [web.dev: common issues](https://web.dev/articles/push-notifications-common-issues-and-reporting-bugs) |
| iOS / iPadOS 16.4+ | **Only for Home Screen web apps.** The site must serve a manifest with `display: standalone` or `fullscreen`, and the user must add it with Share → "Add to Home Screen". Plain Safari tabs cannot subscribe. | [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) |
| iOS details | Delivered through APNs, and no Apple Developer Program membership is needed. Allow `*.push.apple.com` endpoints. Notifications appear on the Lock Screen, in Notification Center and on Apple Watch, and they respect Focus. The Badging API is also supported. Third-party iOS browsers can offer Add to Home Screen from 16.4. | same |
| macOS Safari 16+ (Ventura) | Supported | [WebKit: Meet Web Push](https://webkit.org/blog/12945/meet-web-push/) |

**What this means for iPhone users:** Web Push only reaches someone after they have (a) found and used "Add to Home Screen", (b) opened the installed app, and (c) tapped a control that grants permission. Plan on a share of iPhone users never getting this far. Those users need another Channel.

### Permission prompt rules

- iOS lets you request permission only "in response to direct user interaction — such as tapping on a 'subscribe' button". [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- MDN: request consent only in response to a user gesture. Firefox (from version 72) and Safari already block prompts that are not triggered by a gesture. [MDN: Using the Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API)
- Recommended patterns from web.dev:
  - ask at the moment the value is obvious (for example "notify me when…")
  - use a **double permission** flow, where the app's own UI asks first and the browser prompt only appears after a yes, because a dismissed browser prompt can mean the site is "permanently blocked"
  - put the toggle in a settings panel
  - do not prompt on page load

  [web.dev: Permission UX](https://web.dev/articles/push-notifications-permissions-ux)

### Constraints

- **Payload size:** push services must accept at least **4096 bytes**. A larger payload can be rejected with HTTP 413. [web.dev: common issues](https://web.dev/articles/push-notifications-common-issues-and-reporting-bugs) The usual approach is to send a short title and body plus a URL or id, and fetch the details when the user taps.
- **Push subscriptions expire or get revoked.** A send that returns **404 or 410** means the server should delete that push subscription. A **429** response includes `Retry-After`. [web.dev: common issues](https://web.dev/articles/push-notifications-common-issues-and-reporting-bugs) The `pushsubscriptionchange` event fires when the browser refreshes, revokes or loses a push subscription. It has "Limited availability" (not Baseline), so the server has to treat 404 and 410 as the reliable signal. [MDN: pushsubscriptionchange](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event)
- **One push subscription per browser or device.** Someone with a phone and a laptop has several rows. iOS also allows the same web app to be installed more than once on one device. [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- **Quotas:** Firefox limits pushes that do not show a notification. Chrome has no limits. [MDN: Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- **HTTPS is required** because service workers only run in secure contexts. [Firebase: FCM web get started](https://firebase.google.com/docs/cloud-messaging/web/get-started)

### Self-hosted versus a third-party service

| Option | What it is | Cost | Trade-offs |
| --- | --- | --- | --- |
| **`web-push` npm library** (self-hosted) | Node library that implements the Web Push Protocol and payload encryption, and generates VAPID keys. [github.com/web-push-libs/web-push](https://github.com/web-push-libs/web-push) | Free. The browsers' own push services (FCM, autopush, APNs) cost nothing to send through. | Cadence stores push subscriptions in SQLite and handles 404 and 410 cleanup itself. No vendor SDK and no extra data processor. |
| **Firebase Cloud Messaging (web)** | Firebase JS SDK plus a Firebase service worker. It uses VAPID keys configured in the Firebase console, and works in any browser that supports the Push API. [Firebase docs](https://firebase.google.com/docs/cloud-messaging/web/get-started) | "Cloud Messaging (FCM): No-cost" [Firebase pricing](https://firebase.google.com/pricing) | Adds a Google project, the Firebase SDK and FCM registration tokens. Underneath it is still the same Web Push, so the iOS install requirement still applies. |
| **OneSignal** | Hosted, multi-channel (push, email, SMS) with a dashboard and SDK. [onesignal.com/pricing](https://onesignal.com/pricing) | Free tier: web push "Max 10,000 subscribers per send". Growth plan: from $19/mo plus **$0.004 per web push subscriber**. | Fastest route to a prompt UI and analytics. Adds a vendor and their data model, and user identity has to be mapped to Cadence's. The iOS install requirement is unchanged. |

### Implementation work for this stack (estimate)

Not taken from a source. This is an estimate of the work:

1. `public/manifest.webmanifest` with `display: "standalone"`, icons and `id`, plus a `<link rel="manifest">` in the root layout.
2. A service worker served at the site root, for example `public/sw.js`. It needs `push` and `notificationclick` handlers, and optionally `pushsubscriptionchange`. Register it on the client.
3. A Drizzle table for push subscriptions keyed by user (endpoint, `p256dh`, `auth`, created/last-success timestamps), plus a migration.
4. A React Router action that stores and deletes push subscriptions (with a CSRF check), and a settings toggle that uses the double-permission pattern.
5. A server module (`app/lib/push.server.ts`) using `web-push` that sends to all of a person's push subscriptions and deletes on 404/410. VAPID keys go in env vars. Add an `.outbox`-style fake for dev and tests, like the existing mailer.
6. iOS "Add to Home Screen" instructions in the UI, because iOS has no install prompt.

Rough size: **medium**. The most work is in the service worker and the iOS install flow.

---

## 2. SMS (for example Twilio)

### Platform support

Every phone, with no install and no permission prompt. Getting an SMS still requires a verified phone number and documented opt-in consent (see below).

### Cost (Twilio, prices as of November 2026)

- **US:** $0.0083 per outbound SMS **segment** on long code, toll-free or short code numbers. Carrier pass-through fees are added on top, for example about $0.0035–$0.005 per long-code SMS by carrier (AT&T, T-Mobile, Verizon). Failed messages cost $0.001. [Twilio US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us)
- **Australia (example of an international rate):** $0.0515 per outbound segment from a mobile number or an alphanumeric sender ID. [Twilio AU SMS pricing](https://www.twilio.com/en-us/sms/pricing/au)
- Prices vary a lot by country. See the [full CSV](https://assets.cdn.prod.twilio.com/pricing-csv/SMSPricing.csv). You also pay monthly for each sender number, and 10DLC has registration fees.

### Regulatory and opt-in requirements

- **US A2P 10DLC:** "Anyone sending SMS/MMS messages over a 10DLC number from an application to the US must register", and that includes hobbyists. You register a **Brand** (who is sending) and a **Campaign** (how people opt in, opt out and get help, plus the purpose of the messages). Unregistered traffic is charged extra carrier fees and filtered more. Toll-free numbers and short codes are separate, alternative routes with their own verification. [Twilio: A2P 10DLC](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc)
- **Registration fees:** [Twilio: A2P 10DLC pricing and fees](https://help.twilio.com/articles/1260803965530-What-pricing-and-fees-are-associated-with-the-A2P-10DLC-service-).
- **Other countries** have their own sender-ID and registration rules. Twilio says it handles "carrier nuances in every country". [Twilio AU pricing](https://www.twilio.com/en-us/sms/pricing/au) Check each target country before launch.
- **Consent:** keep a record of each person's opt-in and honour STOP/HELP. Both are part of the 10DLC Campaign definition.

### Implementation work

- **Code: small.** It is one HTTPS POST to the Twilio Messages API, with the same transport shape as `MailTransport`.
- **Product and ops: large.** You need phone-number capture and verification, consent records, STOP handling (inbound webhook), registration paperwork, per-country rules, and cost per message.

---

## 3. Email as the phone baseline

- **Platform support:** every phone has a mail app with its own native push notifications. No install or permission flow is needed on Cadence's side.
- **Existing infrastructure:** Cadence already sends through Postmark (`app/lib/mailer.server.ts`, with an `.outbox/` fallback in dev).
- **Cost (Postmark):** Free plan with 100 emails/mo. Basic is $15/mo for 10,000 emails plus $1.80 per extra 1,000. Pro is $16.50/mo with $1.30 per extra 1,000. [Postmark pricing](https://postmarkapp.com/pricing)
- **Constraints:** it is slower to be seen and easy to miss. Whether it arrives on time depends on the person's mail-app notification settings, and whether it lands in the inbox depends on deliverability. It is the only Channel that reaches everyone with an account without extra setup.
- **Implementation work: minimal.** The transport already exists, so this is just a new email per Notification type.

---

## Side-by-side comparison

| | Web Push (installed PWA) | SMS (Twilio) | Email (Postmark) |
| --- | --- | --- | --- |
| Android | Yes, works in the Chrome browser | Yes | Yes |
| iPhone / iPad | Only 16.4+, and only after "Add to Home Screen" plus a permission granted from a tap | Yes | Yes |
| User setup | Grant permission (and install on iOS) | Give and verify a phone number, and opt in | None, beyond having an account |
| Payload | At least 4 KB guaranteed. Should be a short title/body plus a link | Billed per segment | Rich HTML |
| Marginal cost | Free (self-hosted or FCM). OneSignal Growth $0.004/subscriber | US $0.0083/segment plus carrier fees. AU $0.0515. Registration fees | About $1.20–$1.80 per 1,000 above plan |
| Regulatory | Browser permission only | 10DLC (US) or each country's rules, consent and STOP | Standard email rules (unsubscribe for non-transactional email) |
| Ongoing upkeep | Clean up expired push subscriptions (404/410) | Consent records, STOP webhook, cost monitoring | Deliverability (already handled) |
| Implementation size | Medium (manifest, service worker, push subscription table, action, sender) | Small code, large compliance work | Minimal (already in place) |

## Sources

- WebKit: [Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Meet Web Push](https://webkit.org/blog/12945/meet-web-push/)
- MDN: [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), [pushsubscriptionchange](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event), [Using the Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API)
- web.dev: [Subscribing a user](https://web.dev/articles/push-notifications-subscribing-a-user), [Web Push Protocol](https://web.dev/articles/push-notifications-web-push-protocol), [Permission UX](https://web.dev/articles/push-notifications-permissions-ux), [Common issues](https://web.dev/articles/push-notifications-common-issues-and-reporting-bugs)
- IETF: [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030), [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.html)
- Vendors: [web-push](https://github.com/web-push-libs/web-push), [Firebase FCM web](https://firebase.google.com/docs/cloud-messaging/web/get-started), [Firebase pricing](https://firebase.google.com/pricing), [OneSignal pricing](https://onesignal.com/pricing), [Twilio US](https://www.twilio.com/en-us/sms/pricing/us) / [AU](https://www.twilio.com/en-us/sms/pricing/au) pricing, [Twilio A2P 10DLC](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc), [Postmark pricing](https://postmarkapp.com/pricing)
