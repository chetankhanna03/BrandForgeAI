# Deploy BrandForgeAI on Render

The root `render.yaml` creates one **free Docker web service**. It runs Next.js on Render's public port and FastAPI on private loopback port 8000. Next.js forwards `/api/*` to FastAPI, so login cookies, uploads, and checks use the same HTTPS origin. The health check goes through both servers. If either process exits, the container exits so Render can restart it.

## Create the service

1. Sign in to [Render](https://dashboard.render.com/) and connect the GitHub account with access to this private repository.
2. Select **New > Blueprint**, choose **BrandForgeAI**, and use branch **main** with Blueprint path **render.yaml**.
3. Enter your NVIDIA API Catalog key when Render prompts for `NVIDIA_API_KEY`. Enter it only in Render's secret field. Never put it in the repository, frontend, or chat.
4. Check that the service plan is **Free**, then deploy. The first deployment builds both applications and can take several minutes.
5. Open the service's assigned HTTPS URL after the deploy is healthy. Use **Sign in to judge demo**, then finish or skip the walkthrough and select **Prepare judge demo**.
6. Select **Check Nemotron connection**, run the approved poster, then run the poster with issues. A healthy HTTP endpoint alone does not verify NVIDIA access or quota.

No manual URL wiring is required for the default Render URL. The launcher reads `RENDER_EXTERNAL_URL` and sets the allowed frontend origin. Secure session cookies are enabled. FastAPI is not exposed on a separate public port.

The public deployment disables owner-account signup with `BRANDFORGE_OWNER_SETUP=false`. Judge login still creates a fresh isolated workspace with sample rules. Local owner setup is unchanged. Existing owner accounts can still sign in if their database is preserved. Do not enable owner setup on a public URL: the internal proxy connects from loopback.

## Free service behavior

Render's free service sleeps after 15 minutes without traffic. Opening the public URL wakes the whole app, usually in about a minute. Render may show its startup page first. The app is not available while the service is waking up, suspended, or being rebuilt. A free plan does not guarantee continuous availability.

The free filesystem is temporary. Restarts, sleeping, and deployments can remove accounts, sessions, drafts, uploaded media, and edited rules. The next judge login creates new sample data. If an existing browser session expires after a restart, sign in again. Keep important work elsewhere.

Both servers share the free instance's 512 MB of RAM. Large image or video checks may exceed that limit. Test the actual sample posters on the deployed instance before sharing the link. NVIDIA access, quota, and response times are separate from hosting.

## Keep saved work and avoid idle sleeping

To use persistent SQLite storage, change `plan: free` in `render.yaml` to an available paid web-service plan, and add this under that same service:

```yaml
    disk:
      name: brandforge-data
      mountPath: /var/data
      sizeGB: 1
```

Keep `BRANDFORGE_DB=/var/data/brandforge.db`. All brand databases and uploaded media are stored alongside it, so the same disk preserves them. Use one service instance and one API worker with this SQLite setup. Review Render's displayed compute and disk prices before applying the change. Paid compute avoids idle sleeping; the disk is billed separately. Keep backups of the entire data directory.

For a custom domain, set `BRANDFORGE_FRONTEND_ORIGIN` to its exact HTTPS origin without a trailing slash and restart. The default remains the assigned `onrender.com` URL.

## Verify before submitting to judges

- Open the public URL on another device while your laptop's local servers are stopped.
- Sign in with the displayed judge credentials and start the demo workspace.
- Check Nemotron connectivity and analyze both real PNG posters.
- Save a passing draft, submit it, and approve it.
- Sign out and sign back in to confirm a fresh demo and walkthrough.
- Check `/api/health` for `{"status":"ok"}`. This checks application reachability, not NVIDIA connectivity.

Use Render's **Logs** and **Events** to investigate startup failures. Configure a monitoring service against `/api/health` if you want downtime alerts. Monitoring is not an uptime guarantee.

## Build locally with Docker

```sh
docker build -t brandforge-ai .
docker run --rm -p 10000:10000 --env-file backend/.env -e PORT=10000 -e BRANDFORGE_DB=/var/data/brandforge.db -e BRANDFORGE_FRONTEND_ORIGIN=http://localhost:10000 -e BRANDFORGE_SECURE_COOKIE=false -e BRANDFORGE_OWNER_SETUP=false brandforge-ai
```

Open `http://localhost:10000`. This local command uses temporary container storage; add a volume at `/var/data` if persistence is needed. The `.dockerignore` excludes credentials, databases, local caches, and dependencies from the build context.

References: [Render Blueprints](https://render.com/docs/blueprint-spec), [free service limits](https://render.com/docs/free), [persistent disks](https://render.com/docs/disks).
