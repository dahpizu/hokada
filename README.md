# HOKADA

HOKADA is a delivery booking and tracking app with separate customer and rider experiences. Customers can request and track deliveries, while riders manage assignments and update delivery status. The Express API handles payment verification and authenticated rider operations, including availability, delivery assignment, status changes, and GPS updates.

## Run locally

Install dependencies and start the frontend and API in separate terminals:

```sh
npm install
npm run dev
```

```sh
npm run server
```

The frontend runs on `http://localhost:5173`; the API defaults to port `4242`.

## Configuration

Set these values in `.env` for local development. Never expose the service role key or Paystack secret in frontend variables.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Frontend | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend | Supabase publishable/anon key |
| `VITE_TURNSTILE_SITE_KEY` | Frontend | Cloudflare Turnstile site key |
| `VITE_PAYMENT_API_URL` | Frontend | Express API base URL; defaults to `http://localhost:4242` |
| `SUPABASE_URL` | API | Supabase project URL (can fall back to `VITE_SUPABASE_URL`) |
| `SUPABASE_SERVICE_ROLE_KEY` | API | Server-only key for trusted database operations |
| `SUPABASE_PUBLISHABLE_KEY` | API | Key used to validate customer and rider access tokens; can fall back to `VITE_SUPABASE_PUBLISHABLE_KEY` |
| `PAYSTACK_SECRET_KEY` | API | Server-only Paystack secret |
| `CLIENT_ORIGIN` | API | Comma-separated allowed frontend origins; defaults to `http://localhost:5173` |
| `PAYSTACK_CALLBACK_URL` | API | Optional payment return URL |
| `PORT` | API | Optional API port; defaults to `4242` |

Enable CAPTCHA in Supabase Auth and configure Cloudflare Turnstile with the matching site and secret keys. Supabase validates the CAPTCHA token sent by the customer and rider auth forms. For local development, allow `localhost` and `127.0.0.1` in the Turnstile widget’s Hostname Management. Before deployment, add the deployed frontend origin to `CLIENT_ORIGIN` and the Turnstile widget’s allowed hostnames.

The rider app uses a separate browser session from the customer app. Riders may need to sign in once after this change. Keep the Express API available in both local development and production; rider availability, delivery actions, and location updates now go through it. The rider API validates the Supabase access token and checks the rider profile and approval state on each request.

## Scripts

- `npm run dev` — start the Vite development server
- `npm run server` — start the Express API
- `npm run build` — create the production frontend bundle
- `npm run preview` — preview the production frontend bundle
- `npm run lint` — run ESLint
