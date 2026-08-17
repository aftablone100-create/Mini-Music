# Mini Music — YouTube search proxy

A tiny, dependency-free Node.js server that holds your YouTube Data API v3
key so the Mini Music frontend (and its users) never see it.

## Run locally

```
cd server
cp .env.example .env      # then edit .env and paste in your real API key
YOUTUBE_API_KEY=$(grep YOUTUBE_API_KEY .env | cut -d= -f2) node server.js
```

Or just export the variables directly:

```
export YOUTUBE_API_KEY=your-real-key
export ALLOWED_ORIGIN=*
node server.js
```

It starts on `http://localhost:8787` by default (`PORT` to change it).

## Deploy

This is a plain `http` server with zero dependencies, so it runs anywhere
Node 18+ runs: Render, Railway, Fly.io, a small VPS, etc.

1. Deploy this `server/` folder.
2. Set the `YOUTUBE_API_KEY` environment variable on the host (never in code).
3. Optionally set `ALLOWED_ORIGIN` to your app's real origin instead of `*`.
4. Note the public URL the host gives you (e.g. `https://mini-music-proxy.onrender.com`).
5. In the frontend's `app.js`, set `YT_PROXY_BASE` to that URL.

## Endpoint

```
GET /api/youtube/search?q=<query>&maxResults=<1-25>
```

Returns:
```json
{ "items": [{ "videoId": "...", "title": "...", "channel": "...", "thumbnail": "..." }] }
```

The API key is attached server-side only and never appears in the response
or in any request the browser makes.
