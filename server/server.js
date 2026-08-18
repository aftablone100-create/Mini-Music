/**
 * Mini Music — YouTube search proxy.
 *
 * Keeps the YouTube Data API v3 key on the server only. The frontend
 * never sees it and never sends it. Requires Node.js 18+ (uses the
 * built-in `fetch`). No npm dependencies.
 *
 * Setup:
 *   1. Set the YOUTUBE_API_KEY environment variable (see .env.example).
 *   2. Run: node server.js
 *   3. Point the frontend's YT_PROXY_BASE (in app.js) at wherever
 *      this ends up running, e.g. https://your-proxy.example.com
 */

const http = require("http");
const { URL } = require("url");

const PORT = process.env.PORT || 8787;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// Origin(s) allowed to call this proxy from the browser.
// "*" is fine for personal use; set it to your app's real origin
// (e.g. "https://yourname.github.io") to lock it down further.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

if (!YOUTUBE_API_KEY) {
  console.error(
    "Missing YOUTUBE_API_KEY environment variable. " +
    "Set it (see .env.example) before starting the server."
  );
  process.exit(1);
}


/* ---------- very small in-memory rate limiter (best-effort) ---------- */

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30; // requests per IP per window
const hits = new Map();

function isRateLimited(ip) {

  const now = Date.now();
  const entry = hits.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  entry.count += 1;
  hits.set(ip, entry);

  return entry.count > RATE_LIMIT_MAX;

}


/* ---------- helpers ---------- */

function corsHeaders() {

  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

}

function sendJSON(res, status, body) {

  res.writeHead(status, {
    "Content-Type": "application/json",
    ...corsHeaders()
  });

  res.end(JSON.stringify(body));

}


/* ---------- YouTube search (server-side key) ---------- */

async function handleSearch(res, query) {

  const q = (query.get("q") || "").trim();

  if (!q) {
    sendJSON(res, 400, { error: "Missing search query." });
    return;
  }

  if (q.length > 100) {
    sendJSON(res, 400, { error: "Search query too long." });
    return;
  }

  const maxResults = Math.min(
    Math.max(parseInt(query.get("maxResults") || "15", 10) || 15, 1),
    25
  );

  const upstreamUrl =
    "https://www.googleapis.com/youtube/v3/search" +
    "?part=snippet&type=video&videoCategoryId=10" +
    `&maxResults=${maxResults}` +
    `&q=${encodeURIComponent(q)}` +
    `&key=${encodeURIComponent(YOUTUBE_API_KEY)}`;

  try {

    const upstreamRes = await fetch(upstreamUrl);
    const data = await upstreamRes.json();

    if (!upstreamRes.ok) {

      const reason = data?.error?.errors?.[0]?.reason || "";

      sendJSON(res, upstreamRes.status, {
        error: "YouTube search failed.",
        reason
      });

      return;

    }

    // Only pass through the fields the frontend actually needs —
    // never the raw upstream payload (which would still be
    // effectively fine, but there's no reason to leak more than
    // necessary through the proxy).
    const items = (data.items || [])
      .filter(item => item.id && item.id.videoId)
      .map(item => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        channel: item.snippet.channelTitle,
        thumbnail:
          item.snippet.thumbnails?.default?.url ||
          item.snippet.thumbnails?.medium?.url ||
          ""
      }));

    sendJSON(res, 200, { items });

  } catch (err) {

    sendJSON(res, 502, { error: "Couldn't reach YouTube." });

  }

}


/* ---------- YouTube playlist import (server-side key) ---------- */

// Accepts a full playlist URL (youtube.com/playlist?list=..., a watch
// URL with &list=..., a youtu.be link with ?list=...) or a bare
// playlist ID, and returns just the ID.
function extractPlaylistId(input) {

  const raw = (input || "").trim();

  if (!raw) return null;

  // Bare ID — YouTube playlist IDs are alphanumeric plus - and _.
  if (/^[A-Za-z0-9_-]{10,64}$/.test(raw) && !raw.includes("://")) {
    return raw;
  }

  // People commonly paste links without a scheme (copied from an app's
  // share sheet, or typed as "youtube.com/..."/"www.youtube.com/...").
  // `new URL()` throws on those, so retry with "https://" prefixed
  // whenever the first parse attempt fails.
  const candidates = [raw];

  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
    candidates.push(`https://${raw}`);
  }

  for (const candidate of candidates) {

    try {

      const parsed = new URL(candidate);
      const listParam = parsed.searchParams.get("list");

      if (listParam) return listParam;

    } catch (e) {
      // Not a valid URL — try the next candidate, if any.
    }

  }

  return null;

}


const MAX_PLAYLIST_ITEMS = 200; // cap pages fetched to bound quota use

// Strips the `key` param before a URL ever hits the logs.
function redactKey(u) {
  return u.replace(/([?&]key=)[^&]*/, "$1REDACTED");
}

// Logs enough of a failed/empty YouTube API response to debug the
// "not found or private" issue, without ever writing YOUTUBE_API_KEY
// (or any URL containing it) to the logs.
function logYoutubeApiIssue(label, { url, status, statusText, data }) {

  console.error(
    `[youtube/playlist] ${label}\n` +
    `  request: ${redactKey(url)}\n` +
    `  status: ${status} ${statusText || ""}\n` +
    `  response: ${JSON.stringify(data)}`
  );

}

async function handlePlaylist(res, query) {

  const rawInput = query.get("url") || query.get("id") || "";
  const playlistId = extractPlaylistId(rawInput);

  if (!playlistId) {
    console.error(`[youtube/playlist] Couldn't extract a playlist ID from input: ${JSON.stringify(rawInput)}`);
    sendJSON(res, 400, { error: "Couldn't find a playlist in that link." });
    return;
  }

  try {

    // Playlist title/metadata.
    const metaUrl =
      "https://www.googleapis.com/youtube/v3/playlists" +
      "?part=snippet" +
      `&id=${encodeURIComponent(playlistId)}` +
      `&key=${encodeURIComponent(YOUTUBE_API_KEY)}`;

    const metaRes = await fetch(metaUrl);
    const metaData = await metaRes.json();

    if (!metaRes.ok) {

      logYoutubeApiIssue("playlists.list request failed", {
        url: metaUrl,
        status: metaRes.status,
        statusText: metaRes.statusText,
        data: metaData
      });

      const reason =
        metaData?.error?.errors?.[0]?.reason ||
        metaData?.error?.status ||
        "";
      const message = metaData?.error?.message || "";

      sendJSON(res, metaRes.status, {
        error: "Couldn't load that playlist.",
        reason,
        message
      });

      return;

    }

    const playlistInfo = metaData.items && metaData.items[0];

    if (!playlistInfo) {

      // A 200 with an empty items array is exactly what the API
      // returns for a bad/mistyped ID, an ID for a different
      // resource type, or a playlist the key's project can't see —
      // log the full response (minus the key) so the real cause is
      // visible instead of guessing.
      logYoutubeApiIssue("playlists.list returned no items for this ID", {
        url: metaUrl,
        status: metaRes.status,
        statusText: metaRes.statusText,
        data: metaData
      });

      sendJSON(res, 404, { error: "Playlist not found or is private.", playlistId });
      return;
    }

    // Playlist items, paginated.
    const items = [];
    let pageToken = "";

    do {

      const itemsUrl =
        "https://www.googleapis.com/youtube/v3/playlistItems" +
        "?part=snippet" +
        `&playlistId=${encodeURIComponent(playlistId)}` +
        "&maxResults=50" +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "") +
        `&key=${encodeURIComponent(YOUTUBE_API_KEY)}`;

      const itemsRes = await fetch(itemsUrl);
      const itemsData = await itemsRes.json();

      if (!itemsRes.ok) {

        logYoutubeApiIssue("playlistItems.list request failed", {
          url: itemsUrl,
          status: itemsRes.status,
          statusText: itemsRes.statusText,
          data: itemsData
        });

        const reason =
          itemsData?.error?.errors?.[0]?.reason ||
          itemsData?.error?.status ||
          "";
        const message = itemsData?.error?.message || "";

        sendJSON(res, itemsRes.status, {
          error: "Couldn't load that playlist's videos.",
          reason,
          message
        });

        return;

      }

      for (const item of (itemsData.items || [])) {

        const videoId = item.snippet?.resourceId?.videoId;
        const title = item.snippet?.title;

        // Skip private/deleted placeholder entries.
        if (!videoId || !title || title === "Private video" || title === "Deleted video") {
          continue;
        }

        items.push({
          videoId,
          title,
          channel: item.snippet.videoOwnerChannelTitle || item.snippet.channelTitle || "",
          thumbnail:
            item.snippet.thumbnails?.default?.url ||
            item.snippet.thumbnails?.medium?.url ||
            ""
        });

      }

      pageToken = itemsData.nextPageToken || "";

    } while (pageToken && items.length < MAX_PLAYLIST_ITEMS);

    sendJSON(res, 200, {
      id: playlistId,
      title: playlistInfo.snippet?.title || "Imported playlist",
      items
    });

  } catch (err) {

    console.error(
      `[youtube/playlist] Unexpected error while fetching playlist ${playlistId}: ` +
      `${err && err.message ? err.message : err}`
    );

    sendJSON(res, 502, { error: "Couldn't reach YouTube." });

  }

}


/* ---------- server ---------- */

const server = http.createServer((req, res) => {

  const url = new URL(req.url, `http://${req.headers.host}`);
  const ip = req.socket.remoteAddress || "unknown";

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendJSON(res, 405, { error: "Method not allowed." });
    return;
  }

  if (url.pathname === "/health") {
    sendJSON(res, 200, { ok: true });
    return;
  }

  if (isRateLimited(ip)) {
    sendJSON(res, 429, { error: "Too many requests. Try again in a moment." });
    return;
  }

  if (url.pathname === "/api/youtube/search") {
    handleSearch(res, url.searchParams);
    return;
  }

  if (url.pathname === "/api/youtube/playlist") {
    handlePlaylist(res, url.searchParams);
    return;
  }

  sendJSON(res, 404, { error: "Not found." });

});

server.listen(PORT, () => {
  console.log(`Mini Music YouTube proxy running on port ${PORT}`);
});



