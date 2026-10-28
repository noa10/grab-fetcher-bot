# Security Policy

## Reporting a vulnerability

Open a private report through GitHub's [Security Advisories](https://github.com/noa10/grab-fetcher-bot/security/advisories/new)
rather than a public issue. Please include the deployment type (self-hosted or
Vercel serverless), the route or file involved, and what an unauthenticated
caller can reach.

Expect an acknowledgement within a few days. This is a personal open-source
project, not a staffed product.

## What the project promises

- **No anonymous data.** Every order, customer, review, dashboard and export
  endpoint requires an authenticated session. The serverless deployment verifies
  an HMAC-signed `HttpOnly` cookie on each request; the self-hosted Express app
  uses a server-side session.
- **Fail closed.** If `SESSION_SECRET` is unset (or still the placeholder value),
  the serverless deployment refuses to serve data with `503` rather than signing
  cookies with a known value.
- **No secrets in the repo.** Credentials come from the environment only. `.env`
  is gitignored, and `.env.example` contains placeholders.
- **No wildcard CORS** on endpoints that return merchant data.

## What it does not promise

- **Grab's portal is not an API.** Scraping it may conflict with the terms that
  apply to your account. You are responsible for your own account and for the
  poll interval you choose.
- **No multi-tenant isolation.** One deployment serves one merchant account.
  Do not point a shared instance at several merchants' credentials.
- **Session revocation is by expiry.** The serverless cookie lives 12 hours;
  rotating `SESSION_SECRET` invalidates every session immediately.

## Hardening checklist for your own deployment

1. Use a long random `SESSION_SECRET` (`openssl rand -hex 64`) and a unique
   `ADMIN_PASSWORD`; never reuse your Grab password.
2. Keep `MONGODB_URI` on a database you control, with network access limited to
   your app.
3. Set `COOKIE_SECURE=true` when TLS is terminated in front of the app (the
   serverless deployment does this by default).
4. Rotate the Grab password if it has ever been committed, pasted into a chat,
   or stored outside your secret manager.
