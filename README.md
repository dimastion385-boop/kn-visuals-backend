# KN Visuals Backend

Cloudflare Workers + D1 backend for KN Visuals Pro.

## What is included

- Local account registration/login API
- Free/Pro plan field
- License key checking and first-device binding
- Configuration save/load
- Health endpoint
- D1 schema

## Important

Before deployment, replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.toml` with your D1 database ID.

The login token in this prototype is deliberately simple and is NOT suitable as a final production authentication system. Before selling the app publicly, replace it with short-lived signed sessions/JWTs and add rate limiting, password hashing with a memory-hard algorithm, admin authentication, and audit logging.

## Cloudflare setup

1. Create a D1 database named `kn_visuals`.
2. Put its database ID into `wrangler.toml`.
3. Run the migration:
   `npx wrangler d1 execute kn_visuals --remote --file=migrations/0001_init.sql`
4. Deploy:
   `npx wrangler deploy`

If deploying through the Cloudflare GitHub UI, configure the repository as a Worker project and make sure `wrangler.toml`, `src/index.js`, and `migrations/0001_init.sql` are present.

## API

POST `/api/register`
POST `/api/login`
GET `/api/me`
POST `/api/license/check`
GET `/api/configs`
POST `/api/configs`
GET `/api/health`
