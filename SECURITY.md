# Security and runtime configuration

The application now fails closed when authentication, a provider, a model, or a required integration capability has not been configured. Set these values in the deployment's secret/environment configuration; do not commit credentials to the repository.

## Required owner authentication

- `APP_AUTH_PASSWORD`: an owner sign-in password with at least 16 characters. Use a unique password.
- `APP_AUTH_SECRET`: a random, high-entropy secret of at least 32 characters. Use a cryptographically secure generator and do not reuse the password as the signing key.

Protected `/api/*` endpoints return `AUTH_CONFIGURATION_MISSING` until both values are valid. The owner session cookie is HttpOnly and SameSite=Strict. State-changing browser requests must include a matching Origin/Host. Do not place API keys or passwords in URLs.

## AI provider and model selection

Set credentials only for providers that should be available:

- Gemini: `GEMINI_API_KEY` and `GEMINI_MODEL`
- Groq: `GROQ_API_KEY` and `GROQ_MODEL`
- Mistral: `MISTRAL_API_KEY` and `MISTRAL_MODEL`

Set `ACTIVE_PROVIDER` to one of `gemini`, `groq`, or `mistral` and `ACTIVE_MODEL` to the exact model ID to use for the active provider. Alternatively, choose the provider and model in the application settings. Model IDs are checked against the provider's current live catalogue before execution; an ID that is absent from the current catalogue is rejected, not replaced.

Specialized Gemini capabilities use `GEMINI_TTS_MODEL` and `GEMINI_EMBEDDING_MODEL` when the live provider catalogue returns multiple eligible models. Each selected model is still checked against the current catalogue. Voice selection must be configured with `TTS_VOICE` or provided by the request.

## Database and artifact delivery

- `DATABASE_URL`: PostgreSQL/Neon connection string; configure it in the deployment secret store.
- `PUBLIC_APP_URL`: HTTPS public base URL used to deliver expiring, filename-scoped artifact links. Without it, generated document media cannot be sent as a public URL.
- Configure the database endpoint with TLS certificate verification enabled. The application intentionally does not accept a database URL as persisted configuration through its API.

Artifact links expire after 15 minutes and are scoped to one filename. Keep this base URL stable and ensure the deployment does not rewrite artifact paths.

## WhatsApp via Twilio

Configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, and `TWILIO_USER_PHONE_NUMBER` (or the explicitly supported `USER_PHONE_NUMBER`). Set `TWILIO_WEBHOOK_URL` to the exact canonical public HTTPS webhook URL configured in Twilio. Production webhook signature validation is fail-closed without that canonical URL. The inbound sender must match the configured owner phone number, and the Twilio `MessageSid` must be present for durable deduplication.

## Telegram

Configure `TELEGRAM_BOT_TOKEN` or set the bot token through the authenticated owner interface. In webhook mode, set `TELEGRAM_WEBHOOK_SECRET` and the configured HTTPS webhook URL before starting the bot. The app will reject webhook updates without the matching Telegram secret header. First-time owner pairing requires the currently generated one-time code; the first random Telegram user is never automatically granted owner access.

## Reverse proxies

Set `TRUST_PROXY_HOPS` only when the app is actually deployed behind a trusted proxy, and set it to the exact trusted proxy hop count. Leave it unset for a direct connection. The proxy must overwrite forwarded headers rather than pass through caller-controlled `X-Forwarded-Host` and `X-Forwarded-Proto` values. Do not enable unrestricted proxy trust.

## Verification and operational limits

The repository verification workflow runs the unit tests, TypeScript check, and production build. Those checks do not replace real-provider, database, Telegram, or Twilio integration validation. Such checks require valid credentials and an isolated live test environment; they must be reported as blocked/not run when unavailable, never as passing. The security/session regression tests exercise local cryptographic validation and do not simulate provider success.
