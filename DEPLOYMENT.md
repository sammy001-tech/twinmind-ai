# Deployment with Docker on Render

## Docker image

The repository-root `Dockerfile` builds the Vite frontend and runs the existing Express/TypeScript server. It uses Node.js 22, runs as the non-root `node` user, and listens on `0.0.0.0` using Render's `PORT` value (with 10000 as the container default).

The image command comes from the Dockerfile, so normally leave Render's **Docker Command** override empty. The Dockerfile path is `./Dockerfile` at the repository root.

## Switch an existing Render service

1. Merge the Dockerfile change into the branch used by the Render service.
2. In the Render Dashboard, open the service's **Settings** page and find **Build**.
3. Under **Source**, choose **Edit**. Keep the intended repository and branch, set **Runtime** to **Docker**, and use `./Dockerfile` if Render asks for the Dockerfile path.
4. Save the source settings and deploy. Review the build and runtime logs before treating the switch as successful.
5. Set the Render health-check path to `/api/health` if health checks are configured for this service.

Changing the runtime is a Render Dashboard operation; merging a Dockerfile into GitHub does not by itself change the existing service's runtime.

## Environment and persistence

Keep the service's existing required environment variables configured in Render. Do not put secrets in the repository or in this file. In particular, keep the correct Neon `DATABASE_URL`, owner-auth configuration, provider credentials, and any configured Telegram/Twilio webhook values.

Generated artifacts are stored in Neon PostgreSQL when artifact storage readiness is confirmed; they do not require `ARTIFACTS_DIR` or a Render disk. The local `twin-settings.json` file is only a local cache, not durable storage across container replacement. Settings and integration credentials that must survive replacement depend on successful Neon persistence.

The repository currently has no committed npm lockfile, so the image build uses `npm install` and dependency ranges may resolve to newer compatible versions on later builds. Commit and maintain a lockfile before treating dependency resolution as fully reproducible.
