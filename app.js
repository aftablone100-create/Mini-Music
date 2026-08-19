/* =========================
   BETA WELCOME NOTICE
   (self-contained — doesn't touch playback/library/YouTube state)
========================= */

(function setupBetaNotice() {

  const STORAGE_KEY = "miniMusicHideBetaNotice";

  const betaNotice = document.getElementById("betaNotice");
  const betaContinueBtn = document.getElementById("betaContinueBtn");
  const betaDontShowAgain = document.getElementById("betaDontShowAgain");

  if (!betaNotice || !betaContinueBtn) return;

  const alreadyDismissed = localStorage.getItem(STORAGE_KEY) === "true";

  if (alreadyDismissed) {
    betaNotice.classList.add("dismissed");
    return;
  }

  betaContinueBtn.addEventListener("click", () => {

    if (betaDontShowAgain && betaDontShowAgain.checked) {
      localStorage.setItem(STORAGE_KEY, "true");
    }

    betaNotice.classList.add("dismissed");

  });

})();


const audio = document.getElementById("audio");
const fileInput = document.getElementById("fileInput");

const miniPlayer = document.getElementById("miniPlayer");
const miniPlayBtn = document.getElementById("miniPlayBtn");
const miniProgressFill = document.getElementById("miniProgressFill");
const miniArt = document.getElementById("miniArt");
const miniSpinner = document.getElementById("miniSpinner");

const fullPlayer = document.getElementById("fullPlayer");
const collapseBtn = document.getElementById("collapseBtn");
const fullArt = document.getElementById("fullArt");
const fullSpinner = document.getElementById("fullSpinner");
const dragHandleWrap = document.getElementById("dragHandleWrap");

const shuffleBtn = document.getElementById("shuffleBtn");
const repeatBtn = document.getElementById("repeatBtn");
const queueBtn = document.getElementById("queueBtn");
const queueSheet = document.getElementById("queueSheet");
const closeQueueBtn = document.getElementById("closeQueueBtn");
const queueList = document.getElementById("queueList");

const homeWave = document.getElementById("homeWave");
const toast = document.getElementById("toast");
const progress = document.getElementById("progress");
const volumeInput = document.getElementById("volume");

let songs = [];
let currentIndex = -1;

// Which engine the shared mini-player / full-player currently reflects.
// "local" = the <audio> element, "youtube" = the YouTube IFrame player.
let activeSource = "local";

// Store liked songs by a unique ID instead of just the filename
let liked = JSON.parse(localStorage.getItem("miniMusicLiked") || "[]");

let showingLiked = false;
let isLibraryLoading = true;

// Shuffle / repeat / queue state
let shuffle = JSON.parse(localStorage.getItem("miniMusicShuffle") || "false");
let repeatMode = localStorage.getItem("miniMusicRepeat") || "off"; // off | all | one
const REPEAT_STATES = ["off", "all", "one"];

let playOrder = [];   // array of indices into `songs`, in play order
let orderPos = -1;    // pointer into playOrder for the current song

let saveStateTimer = null;

audio.volume = Number(volumeInput.value) || 0.8;


/* =========================
   INDEXEDDB (persistent library)
========================= */

const DB_NAME = "miniMusicDB";
const DB_VERSION = 2;
const STORE_NAME = "songs";
const YT_PLAYLIST_STORE_NAME = "ytPlaylists";

let dbPromise = null;

function openDB() {

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {

    if (!("indexedDB" in window)) {
      dbPromise = null;
      reject(new Error("IndexedDB not supported"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {

      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(YT_PLAYLIST_STORE_NAME)) {
        db.createObjectStore(YT_PLAYLIST_STORE_NAME, { keyPath: "id" });
      }

    };

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };

  });

  return dbPromise;

}

async function dbAddSong(song) {

  const db = await openDB();

  return new Promise((resolve, reject) => {

    const tx = db.transaction(STORE_NAME, "readwrite");

    tx.objectStore(STORE_NAME).put(song);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);

  });

}

async function dbGetAllSongs() {

  const db = await openDB();

  return new Promise((resolve, reject) => {

    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);

  });

}


/* ---------- YouTube playlists (separate store) ---------- */

async function dbAddPlaylist(playlist) {

  const db = await openDB();

  return new Promise((resolve, reject) => {

    const tx = db.transaction(YT_PLAYLIST_STORE_NAME, "readwrite");

    tx.objectStore(YT_PLAYLIST_STORE_NAME).put(playlist);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);

  });

}

async function dbGetAllPlaylists() {

  const db = await openDB();

  return new Promise((resolve, reject) => {

    const tx = db.transaction(YT_PLAYLIST_STORE_NAME, "readonly");
    const request = tx.objectStore(YT_PLAYLIST_STORE_NAME).getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);

  });

}

async function dbDeletePlaylist(id) {

  const db = await openDB();

  return new Promise((resolve, reject) => {

    const tx = db.transaction(YT_PLAYLIST_STORE_NAME, "readwrite");

    tx.objectStore(YT_PLAYLIST_STORE_NAME).delete(id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);

  });

}


/* =========================
   TOAST / ERROR MESSAGES
========================= */

let toastTimer = null;

function showToast(message) {

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);

}


/* =========================
   NAVIGATION
========================= */

document.querySelectorAll("[data-page]").forEach(button => {

  button.addEventListener("click", () => {

    const page = button.dataset.page;

    document.querySelectorAll(".page").forEach(p => {
      p.classList.remove("active-page");
    });

    const targetPage = document.getElementById(page);

    if (targetPage) {
      targetPage.classList.add("active-page");
    }

    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.classList.remove("active");
    });

    document.querySelectorAll(`[data-page="${page}"]`).forEach(btn => {

      if (btn.classList.contains("nav-btn")) {
        btn.classList.add("active");
      }

    });

  });

});


/* =========================
   FULL-SCREEN PLAYER
========================= */

function openFullPlayer() {
  fullPlayer.classList.add("open");
}

function closeFullPlayer() {
  fullPlayer.classList.remove("open");
  queueSheet.classList.remove("open");
}

miniPlayer.addEventListener("click", () => {
  openFullPlayer();
});

collapseBtn.addEventListener("click", event => {
  event.stopPropagation();
  closeFullPlayer();
});

miniPlayBtn.addEventListener("click", event => {

  event.stopPropagation();
  togglePlayPause();

});


/* Swipe down on the handle / header to close the full player */

(function setupSwipeToClose() {

  let startY = 0;
  let currentY = 0;
  let dragging = false;

  function onStart(y) {
    dragging = true;
    startY = y;
    currentY = y;
    fullPlayer.classList.add("dragging");
  }

  function onMove(y) {

    if (!dragging) return;

    currentY = y;

    const delta = Math.max(0, currentY - startY);

    fullPlayer.style.transform = `translateY(${delta}px)`;

  }

  function onEnd() {

    if (!dragging) return;

    dragging = false;

    fullPlayer.classList.remove("dragging");
    fullPlayer.style.transform = "";

    const delta = currentY - startY;

    if (delta > 90) {
      closeFullPlayer();
    }

  }

  dragHandleWrap.addEventListener("touchstart", e => onStart(e.touches[0].clientY), { passive: true });
  dragHandleWrap.addEventListener("touchmove", e => onMove(e.touches[0].clientY), { passive: true });

  dragHandleWrap.addEventListener("touchend", e => {
    // Prevent the browser from firing synthetic compatibility mouse
    // events after this touch, which would otherwise restart the
    // drag via a phantom mousedown and leave the "dragging" class
    // stuck (breaking the open/close slide animation).
    e.preventDefault();
    onEnd();
  });

})();


/* =========================
   FILE UPLOAD
========================= */

document.getElementById("uploadBtn").addEventListener("click", () => {
  fileInput.click();
});

document.getElementById("libraryUpload").addEventListener("click", () => {
  fileInput.click();
});

function setUploadLoading(isLoading) {

  document.querySelectorAll(".primary-btn").forEach(btn => {

    const spinner = btn.querySelector(".btn-spinner");
    const label = btn.querySelector(".btn-label");

    if (!spinner || !label) return;

    btn.classList.toggle("is-loading", isLoading);
    spinner.hidden = !isLoading;
    btn.disabled = isLoading;

  });

}


fileInput.addEventListener("change", async event => {

  const files = Array.from(event.target.files);

  if (files.length === 0) return;

  if (isLibraryLoading) {
    showToast("Still loading your library — try again in a moment.");
    fileInput.value = "";
    return;
  }

  setUploadLoading(true);

  let addedCount = 0;
  let failedCount = 0;

  for (const file of files) {

    if (!file.type.startsWith("audio/")) {
      failedCount++;
      continue;
    }

    const song = {
      id:
        Date.now().toString() +
        Math.random().toString(36).substring(2, 9),

      name: file.name.replace(/\.[^/.]+$/, ""),

      artist: "Local file",

      blob: file,

      addedAt: Date.now()
    };

    try {

      await dbAddSong(song);

      songs.push({
        id: song.id,
        name: song.name,
        artist: song.artist,
        url: URL.createObjectURL(song.blob),
        addedAt: song.addedAt
      });

      addedCount++;

    } catch (err) {

      failedCount++;

    }

  }

  setUploadLoading(false);

  buildPlayOrder();
  renderTracks(document.getElementById("searchInput").value);

  if (addedCount === 0 && failedCount > 0) {
    showToast("Couldn't add those files. Try a different audio format.");
  } else if (failedCount > 0) {
    showToast(`Added ${addedCount} song${addedCount === 1 ? "" : "s"}, ${failedCount} couldn't be added.`);
  }

  if (songs.length > 0 && currentIndex === -1) {
    loadSong(0, false);
  }

  fileInput.value = "";

});


/* =========================
   PLAYER
========================= */

function loadSong(index, autoplay = true) {

  if (!songs[index]) return;

  // Hand control of the shared mini/full player back to local audio.
  if (activeSource === "youtube") {
    ytPauseForHandoff();
  }
  setActiveSource("local");

  currentIndex = index;

  const song = songs[index];

  const pos = playOrder.indexOf(index);
  orderPos = pos > -1 ? pos : orderPos;

  audio.src = song.url;

  document.getElementById("playerTitle").textContent =
    song.name;

  document.getElementById("playerArtist").textContent =
    song.artist;

  document.getElementById("fullPlayerTitle").textContent =
    song.name;

  document.getElementById("fullPlayerArtist").textContent =
    song.artist;

  document.getElementById("homeNowPlaying").textContent =
    song.name;

  document.getElementById("homeArtist").textContent =
    song.artist;

  updateLikeButton();
  updateMediaSession(song);

  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
  }

  renderTracks(
    document.getElementById("searchInput").value
  );

  renderQueue();

  if (autoplay) {

    audio.play().catch(() => {
      // Autoplay may be blocked without a direct user gesture; ignore.
    });

  }

  // Note: state is persisted by the play/pause/volume/shuffle/repeat
  // handlers and the throttled timeupdate save — not here, since
  // audio.currentTime is always 0 at this point (metadata hasn't
  // loaded yet), which would overwrite a correct saved position.

}


function togglePlayPause() {

  if (activeSource === "youtube") {
    ytTogglePlayPause();
    return;
  }

  if (currentIndex === -1) {

    if (songs.length === 0) return;

    if (orderPos === -1) buildPlayOrder();

    loadSong(playOrder.length ? playOrder[0] : 0);

    return;
  }

  if (audio.paused) {

    audio.play().catch(() => {
      showToast("Couldn't resume playback.");
    });

  } else {

    audio.pause();

  }

}


document.getElementById("playBtn").addEventListener("click", togglePlayPause);


audio.addEventListener("play", () => {

  document.getElementById("playBtn").textContent = "❚❚";
  miniPlayBtn.textContent = "❚❚";

  miniArt.classList.add("spinning");
  fullArt.classList.add("spinning");
  homeWave.classList.add("playing");

  renderTracks(
    document.getElementById("searchInput").value
  );

});


audio.addEventListener("pause", () => {

  document.getElementById("playBtn").textContent = "▶";
  miniPlayBtn.textContent = "▶";

  miniArt.classList.remove("spinning");
  fullArt.classList.remove("spinning");
  homeWave.classList.remove("playing");

  renderTracks(
    document.getElementById("searchInput").value
  );

  savePlaybackState();

});


/* =========================
   LOADING / ERROR STATES
========================= */

audio.addEventListener("waiting", () => {
  miniSpinner.hidden = false;
  fullSpinner.hidden = false;
});

audio.addEventListener("canplay", () => {
  miniSpinner.hidden = true;
  fullSpinner.hidden = true;
});

audio.addEventListener("playing", () => {
  miniSpinner.hidden = true;
  fullSpinner.hidden = true;
});

audio.addEventListener("error", () => {

  miniSpinner.hidden = true;
  fullSpinner.hidden = true;

  if (currentIndex !== -1) {
    showToast("Couldn't play this track. It may be missing or corrupted.");
  }

});


/* =========================
   SHUFFLE / REPEAT / QUEUE ORDER
========================= */

function buildPlayOrder() {

  const currentSongId =
    currentIndex !== -1 && songs[currentIndex]
      ? songs[currentIndex].id
      : null;

  playOrder = songs.map((_, i) => i);

  if (shuffle) {

    for (let i = playOrder.length - 1; i > 0; i--) {

      const j = Math.floor(Math.random() * (i + 1));

      [playOrder[i], playOrder[j]] = [playOrder[j], playOrder[i]];

    }

    if (currentSongId) {

      const curIdx = songs.findIndex(s => s.id === currentSongId);
      const pos = playOrder.indexOf(curIdx);

      if (pos > -1) {
        playOrder.splice(pos, 1);
        playOrder.unshift(curIdx);
      }

    }

  }

  if (currentSongId) {

    const curIdx = songs.findIndex(s => s.id === currentSongId);
    orderPos = playOrder.indexOf(curIdx);

  } else {

    orderPos = -1;

  }

  renderQueue();

}


/* Shared shuffle/repeat/like UI reflects whichever engine (local
   audio or YouTube) is currently active. */

function updateShuffleBtn() {

  const active = activeSource === "youtube" ? ytShuffle : shuffle;
  shuffleBtn.classList.toggle("active", active);

}


function updateRepeatBtn() {

  const mode = activeSource === "youtube" ? ytRepeatMode : repeatMode;

  repeatBtn.classList.toggle("active", mode !== "off");
  repeatBtn.textContent = mode === "one" ? "🔂" : "🔁";

}


function setActiveSource(source) {

  activeSource = source;

  const likeBtn = document.getElementById("likeBtn");

  // The like system only applies to the local library.
  likeBtn.style.display = source === "youtube" ? "none" : "";

  updateShuffleBtn();
  updateRepeatBtn();

}


shuffleBtn.addEventListener("click", () => {

  if (activeSource === "youtube") {

    ytShuffle = !ytShuffle;

    localStorage.setItem("miniMusicYtShuffle", JSON.stringify(ytShuffle));

    updateShuffleBtn();
    ytBuildPlayOrder();

    return;

  }

  shuffle = !shuffle;

  localStorage.setItem("miniMusicShuffle", JSON.stringify(shuffle));

  updateShuffleBtn();

  buildPlayOrder();
  savePlaybackState();

});


repeatBtn.addEventListener("click", () => {

  if (activeSource === "youtube") {

    const idx = REPEAT_STATES.indexOf(ytRepeatMode);
    ytRepeatMode = REPEAT_STATES[(idx + 1) % REPEAT_STATES.length];

    localStorage.setItem("miniMusicYtRepeat", ytRepeatMode);

    updateRepeatBtn();

    return;

  }

  const idx = REPEAT_STATES.indexOf(repeatMode);
  repeatMode = REPEAT_STATES[(idx + 1) % REPEAT_STATES.length];

  localStorage.setItem("miniMusicRepeat", repeatMode);

  updateRepeatBtn();
  savePlaybackState();

});


/* =========================
   NEXT / PREVIOUS
========================= */

function playNext(auto = false) {

  if (activeSource === "youtube") {
    ytPlayNext(auto);
    return;
  }

  if (songs.length === 0) return;

  if (auto && repeatMode === "one") {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }

  if (orderPos === -1) buildPlayOrder();

  let nextPos = orderPos + 1;

  if (nextPos >= playOrder.length) {

    if (auto && repeatMode === "off") {
      audio.pause();
      audio.currentTime = 0;
      return;
    }

    nextPos = 0;

  }

  orderPos = nextPos;
  loadSong(playOrder[orderPos]);

}


function playPrev() {

  if (activeSource === "youtube") {
    ytPlayPrev();
    return;
  }

  if (songs.length === 0) return;

  if (orderPos === -1) buildPlayOrder();

  let prevPos = orderPos - 1;

  if (prevPos < 0) {
    prevPos = playOrder.length - 1;
  }

  orderPos = prevPos;
  loadSong(playOrder[orderPos]);

}


document.getElementById("nextBtn").addEventListener("click", () => playNext(false));
document.getElementById("prevBtn").addEventListener("click", playPrev);


/* =========================
   AUTO NEXT
========================= */

audio.addEventListener("ended", () => {
  playNext(true);
});


/* =========================
   PROGRESS
========================= */

audio.addEventListener("timeupdate", () => {

  if (!audio.duration) return;

  const percent =
    (audio.currentTime / audio.duration) * 100;

  progress.value = percent;
  miniProgressFill.style.width = percent + "%";

  document.getElementById("currentTime").textContent =
    formatTime(audio.currentTime);

  document.getElementById("duration").textContent =
    formatTime(audio.duration);

  if ("mediaSession" in navigator) {

    try {

      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: audio.currentTime
      });

    } catch (e) {
      // Some browsers throw if called too early; safe to ignore.
    }

  }

  throttledSaveState();

});


progress.addEventListener("input", () => {

  if (activeSource === "youtube") {
    ytSeekToPercent(progress.value);
    return;
  }

  if (!audio.duration) return;

  audio.currentTime =
    (progress.value / 100) * audio.duration;

});


function formatTime(seconds) {

  if (!seconds || isNaN(seconds)) {
    return "0:00";
  }

  const minutes =
    Math.floor(seconds / 60);

  const secs =
    Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");

  return `${minutes}:${secs}`;

}


/* =========================
   VOLUME
========================= */

volumeInput.addEventListener("input", event => {

  audio.volume = Number(event.target.value);

  savePlaybackState();

});


/* =========================
   LIKE SYSTEM
========================= */

function isLiked(song) {

  return liked.includes(song.id);

}


function saveLikes() {

  localStorage.setItem(
    "miniMusicLiked",
    JSON.stringify(liked)
  );

}


/* Player heart */

function updateLikeButton() {

  const button =
    document.getElementById("likeBtn");

  if (currentIndex === -1) {

    button.textContent = "♡";
    button.classList.remove("liked");

    return;
  }

  const song =
    songs[currentIndex];

  if (isLiked(song)) {

    button.textContent = "♥";
    button.classList.add("liked");

  } else {

    button.textContent = "♡";
    button.classList.remove("liked");

  }

}


document.getElementById("likeBtn").addEventListener(
  "click",
  () => {

    if (activeSource === "youtube") return;

    if (currentIndex === -1) return;

    toggleLike(currentIndex);

  }
);


/* Main like function */

function toggleLike(index) {

  const song = songs[index];

  if (!song) return;

  if (isLiked(song)) {

    liked =
      liked.filter(id => id !== song.id);

  } else {

    liked.push(song.id);

  }

  saveLikes();

  updateLikeButton();

  renderTracks(
    document.getElementById("searchInput").value
  );

}


/* =========================
   QUEUE
========================= */

queueBtn.addEventListener("click", () => {
  renderQueue();
  queueSheet.classList.add("open");
});

closeQueueBtn.addEventListener("click", () => {
  queueSheet.classList.remove("open");
});


function renderQueue() {

  if (activeSource === "youtube") {
    renderYtQueueSheet();
    return;
  }

  if (songs.length === 0 || orderPos === -1) {

    queueList.innerHTML = `
      <div class="empty">
        <div>♫</div>
        <h3>Queue is empty</h3>
        <p>Play a song to build your queue.</p>
      </div>
    `;

    return;

  }

  const upcoming = [];

  for (let i = 1; i < playOrder.length; i++) {

    const pos = (orderPos + i) % playOrder.length;

    if (pos === orderPos) break;

    upcoming.push({ pos, songIndex: playOrder[pos] });

  }

  if (upcoming.length === 0) {

    queueList.innerHTML = `
      <div class="empty">
        <div>♫</div>
        <h3>End of queue</h3>
        <p>${repeatMode !== "off" ? "Playback will repeat." : "Turn on repeat to keep the music going."}</p>
      </div>
    `;

    return;

  }

  queueList.innerHTML = upcoming.map((item, i) => {

    const song = songs[item.songIndex];

    if (!song) return "";

    return `
      <div class="queue-item">

        <span class="queue-num">${i + 1}</span>

        <div class="queue-info">
          <strong>${escapeHTML(song.name)}</strong>
          <small>${escapeHTML(song.artist)}</small>
        </div>

        <button class="queue-play" onclick="jumpToQueue(${item.pos})" aria-label="Play now">▶</button>

        ${
          i > 0
            ? `<button class="queue-up" onclick="moveQueueUp(${item.pos})" aria-label="Move up">▲</button>`
            : `<span></span>`
        }

      </div>
    `;

  }).join("");

}


window.jumpToQueue = function(pos) {

  orderPos = pos;
  loadSong(playOrder[orderPos]);

};


window.moveQueueUp = function(pos) {

  const prev = pos - 1;

  // Guard against invalid indices and against reordering across
  // the currently-playing song (which sits at orderPos).
  if (prev < 0 || prev === orderPos) return;

  [playOrder[pos], playOrder[prev]] =
    [playOrder[prev], playOrder[pos]];

  renderQueue();
  savePlaybackState();

};


/* =========================
   RENDER SONGS
========================= */

function renderTracks(search = "") {

  const home =
    document.getElementById("homeTracks");

  const library =
    document.getElementById("libraryTracks");

  const searchList =
    document.getElementById("searchTracks");


  document.getElementById("trackCount").textContent =
    String(songs.length).padStart(2, "0") +
    " TRACKS";


  if (isLibraryLoading) {

    const loadingHTML = `
      <div class="empty">
        <div>♫</div>
        <h3>Loading your library…</h3>
        <p>One moment.</p>
      </div>
    `;

    home.innerHTML = loadingHTML;
    library.innerHTML = loadingHTML;

    return;

  }


  const query =
    search.toLowerCase().trim();


  let filtered =
    songs.filter(song => {

      const matchesSearch =
        song.name
          .toLowerCase()
          .includes(query);

      const matchesLiked =
        !showingLiked ||
        isLiked(song);

      return matchesSearch && matchesLiked;

    });


  if (songs.length === 0) {

    home.innerHTML =
      emptyHTML();

    library.innerHTML =
      emptyHTML();

  } else {

    const recent = songs.slice(-5).reverse();

    home.innerHTML =
      createTrackHTML(recent);

    library.innerHTML =
      createTrackHTML(filtered);

  }


  searchList.innerHTML =
    search
      ? createTrackHTML(filtered)
      : `
        <div class="empty">
          <div>⌕</div>
          <h3>Search your music</h3>
          <p>Type a song name above.</p>
        </div>
      `;

}


/* =========================
   EMPTY STATE
========================= */

function emptyHTML() {

  return `
    <div class="empty">

      <div>♫</div>

      <h3>
        ${
          showingLiked
            ? "No liked songs yet"
            : "Your library is empty"
        }
      </h3>

      <p>
        ${
          showingLiked
            ? "Tap the heart beside a song to like it."
            : "Add some music to get started."
        }
      </p>

    </div>
  `;

}


/* =========================
   TRACK HTML
========================= */

function createTrackHTML(list) {

  if (list.length === 0) {

    return `
      <div class="empty">

        <div>♫</div>

        <h3>
          ${
            showingLiked
              ? "No liked songs"
              : "No songs found"
          }
        </h3>

        <p>
          ${
            showingLiked
              ? "Like a song and it will appear here."
              : "Try adding some music."
          }
        </p>

      </div>
    `;

  }


  return list.map(song => {

    const index =
      songs.indexOf(song);

    const isLikedSong =
      isLiked(song);

    const isCurrent =
      index === currentIndex;


    return `
      <div class="track ${isCurrent ? "playing" : ""}">

        <span class="track-number">
          ${String(index + 1).padStart(2, "0")}
        </span>

        <div class="track-main">

          <span class="track-title">
            ${escapeHTML(song.name)}
          </span>

          <span class="track-artist">
            ${escapeHTML(song.artist)}
          </span>

        </div>


        <button
          class="track-play"
          onclick="playSong(${index})"
        >
          ${
            isCurrent && !audio.paused
              ? "❚❚"
              : "▶"
          }
        </button>


        <button
          class="track-like ${
            isLikedSong ? "liked" : ""
          }"
          onclick="likeSong(${index})"
          aria-label="${
            isLikedSong
              ? "Unlike song"
              : "Like song"
          }"
        >
          ${
            isLikedSong
              ? "♥"
              : "♡"
          }
        </button>

      </div>
    `;

  }).join("");

}


/* =========================
   TRACK BUTTONS
========================= */

window.playSong = function(index) {

  if (currentIndex === index) {

    if (audio.paused) {

      audio.play().catch(() => {
        showToast("Couldn't resume playback.");
      });

    } else {

      audio.pause();

    }

  } else {

    loadSong(index);

  }

};


window.likeSong = function(index) {

  toggleLike(index);

};


/* =========================
   SEARCH
========================= */

document.getElementById("searchInput")
  .addEventListener("input", event => {

    renderTracks(event.target.value);

  });


/* =========================
   FILTER
========================= */

document.getElementById("allBtn")
  .addEventListener("click", () => {

    showingLiked = false;

    document
      .getElementById("allBtn")
      .classList.add("active");

    document
      .getElementById("likedBtn")
      .classList.remove("active");

    renderTracks(
      document.getElementById("searchInput").value
    );

  });


document.getElementById("likedBtn")
  .addEventListener("click", () => {

    showingLiked = true;

    document
      .getElementById("likedBtn")
      .classList.add("active");

    document
      .getElementById("allBtn")
      .classList.remove("active");

    renderTracks(
      document.getElementById("searchInput").value
    );

  });


/* =========================
   MEDIA SESSION (lock screen controls)
========================= */

function updateMediaSession(song) {

  if (!("mediaSession" in navigator)) return;

  try {

    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.name,
      artist: song.artist,
      album: "Mini Music"
    });

  } catch (e) {
    // Ignore if MediaMetadata isn't available.
  }

}


if ("mediaSession" in navigator) {

  navigator.mediaSession.setActionHandler("play", () => {

    if (activeSource === "youtube") {
      ytPlayer && ytPlayerReady && ytPlayer.playVideo && ytPlayer.playVideo();
      return;
    }

    if (currentIndex === -1) {

      if (songs.length === 0) return;

      if (orderPos === -1) buildPlayOrder();

      loadSong(playOrder[0]);

      return;
    }

    audio.play().catch(() => {});

  });

  navigator.mediaSession.setActionHandler("pause", () => {

    if (activeSource === "youtube") {
      ytPlayer && ytPlayerReady && ytPlayer.pauseVideo && ytPlayer.pauseVideo();
      return;
    }

    audio.pause();

  });

  navigator.mediaSession.setActionHandler("previoustrack", playPrev);

  navigator.mediaSession.setActionHandler("nexttrack", () => playNext(false));

  navigator.mediaSession.setActionHandler("seekto", details => {

    if (details.seekTime === undefined) return;

    if (activeSource === "youtube") {
      ytSeekToSeconds(details.seekTime);
      return;
    }

    if (audio.duration) {
      audio.currentTime = details.seekTime;
    }

  });

  navigator.mediaSession.setActionHandler("stop", () => {

    if (activeSource === "youtube") {
      ytPlayer && ytPlayerReady && ytPlayer.pauseVideo && ytPlayer.pauseVideo();
      return;
    }

    audio.pause();
    audio.currentTime = 0;

  });

}


audio.addEventListener("play", () => {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = "playing";
  }
});


audio.addEventListener("pause", () => {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = "paused";
  }
});


/* =========================
   PLAYBACK-STATE PERSISTENCE
========================= */

function savePlaybackState() {

  if (currentIndex === -1 || !songs[currentIndex]) return;

  const state = {
    songId: songs[currentIndex].id,
    currentTime: audio.currentTime || 0,
    volume: audio.volume,
    shuffle,
    repeatMode
  };

  localStorage.setItem(
    "miniMusicPlaybackState",
    JSON.stringify(state)
  );

}


function throttledSaveState() {

  if (saveStateTimer) return;

  saveStateTimer = setTimeout(() => {
    savePlaybackState();
    saveStateTimer = null;
  }, 4000);

}


window.addEventListener("beforeunload", savePlaybackState);

document.addEventListener("visibilitychange", () => {

  if (document.visibilityState === "hidden") {
    savePlaybackState();
  }

});


function restorePlaybackState() {

  let state = null;

  try {

    const raw = localStorage.getItem("miniMusicPlaybackState");

    if (raw) state = JSON.parse(raw);

  } catch (e) {
    state = null;
  }

  if (state) {

    if (typeof state.shuffle === "boolean") {
      shuffle = state.shuffle;
      shuffleBtn.classList.toggle("active", shuffle);
    }

    if (state.repeatMode && REPEAT_STATES.includes(state.repeatMode)) {
      repeatMode = state.repeatMode;
    }

    if (typeof state.volume === "number" && !isNaN(state.volume)) {
      const safeVolume = Math.min(1, Math.max(0, state.volume));
      audio.volume = safeVolume;
      volumeInput.value = safeVolume;
    }

  }

  updateRepeatBtn();

  buildPlayOrder();

  if (state && state.songId) {

    const idx = songs.findIndex(s => s.id === state.songId);

    if (idx > -1) {

      loadSong(idx, false);

      const resumeTime = state.currentTime || 0;

      const onMeta = () => {

        if (audio.duration) {
          audio.currentTime = Math.min(resumeTime, audio.duration);
        }

        audio.removeEventListener("loadedmetadata", onMeta);

      };

      audio.addEventListener("loadedmetadata", onMeta);

    }

  }

}


/* =========================
   SECURITY
========================= */

function escapeHTML(text = "") {

  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

}


/* =========================
   START
========================= */

async function initLibrary() {

  isLibraryLoading = true;
  document.getElementById("uploadBtn").disabled = true;
  document.getElementById("libraryUpload").disabled = true;
  renderTracks();

  try {

    const stored = await dbGetAllSongs();

    stored.sort((a, b) => a.addedAt - b.addedAt);

    songs = stored.map(s => ({
      id: s.id,
      name: s.name,
      artist: s.artist,
      url: URL.createObjectURL(s.blob),
      addedAt: s.addedAt
    }));

  } catch (err) {

    showToast("Couldn't load your saved library.");
    songs = [];

  }

  isLibraryLoading = false;
  document.getElementById("uploadBtn").disabled = false;
  document.getElementById("libraryUpload").disabled = false;

  restorePlaybackState();
  renderTracks();

}


initLibrary();

/* =========================================================
   YOUTUBE — SEARCH, PLAYLIST IMPORT, AND FULL PLAYER INTEGRATION
   -----------------------------------------------------------
   YouTube videos are streamed only through the official YouTube
   IFrame Player API (in the #ytPlayer element on the YouTube tab) —
   nothing is downloaded, extracted, or cached. This block drives
   that player and mirrors its state onto the SAME mini-player /
   full-player / queue-sheet UI used for local playback, switching
   the shared UI's "activeSource" between "local" and "youtube" as
   the person moves between the two.

   Search and playlist-import requests go through a server-side
   proxy (see /server) so the YouTube Data API v3 key stays off the
   client entirely. The user never enters, sees, or stores an API
   key anywhere in this app, and no YouTube login is ever required.
========================================================= */

// EDIT ME: point this at wherever you deploy the proxy in /server.
// e.g. "https://mini-music-proxy.onrender.com"
const YT_PROXY_BASE = "https://mini-music-api.onrender.com";

const ytSearchBox = document.getElementById("ytSearchBox");
const ytSearchInput = document.getElementById("ytSearchInput");
const ytResultsEl = document.getElementById("ytResults");
const ytQueueTitleEl = document.getElementById("ytQueueTitle");
const ytQueueListEl = document.getElementById("ytQueueList");
const ytPlayerWrapEl = document.getElementById("ytPlayerWrap");

const ytPlaylistInput = document.getElementById("ytPlaylistInput");
const ytImportBtn = document.getElementById("ytImportBtn");
const ytPlaylistsTitleEl = document.getElementById("ytPlaylistsTitle");
const ytPlaylistsEl = document.getElementById("ytPlaylists");

const addToPlaylistSheet = document.getElementById("addToPlaylistSheet");
const addToPlaylistBackdrop = document.getElementById("addToPlaylistBackdrop");
const addToPlaylistList = document.getElementById("addToPlaylistList");
const closeAddToPlaylistBtn = document.getElementById("closeAddToPlaylistBtn");

const miniArtImg = document.getElementById("miniArtImg");
const fullArtImg = document.getElementById("fullArtImg");

let ytLastResults = [];   // most recent search results
let ytQueue = [];         // manually queued videos (separate from playOrder)
let ytSearchTimer = null;

let ytPlaylists = [];             // imported playlists, from IndexedDB
let ytExpandedPlaylistId = null;  // which playlist's track list is expanded
let ytPendingAddSong = null;      // video waiting to be added to a saved playlist

let ytPlayer = null;
let ytPlayerReady = false;
let ytPendingVideoId = null;

// Shuffle / repeat state for YouTube playback (mirrors the local
// shuffle/repeatMode variables but kept separate since they apply to
// a different play context).
let ytShuffle = JSON.parse(localStorage.getItem("miniMusicYtShuffle") || "false");
let ytRepeatMode = localStorage.getItem("miniMusicYtRepeat") || "off";

// The list of videos currently providing prev/next context (a copy
// of whichever list was playing from: search results, the manual
// queue, or an imported playlist's tracks), plus a shuffled play
// order over it — same pattern as the local playOrder/orderPos.
let ytContext = [];
let ytContextLabel = null; // { type: "playlist", id } | null — where ytContext came from
let ytPlayOrder = [];
let ytOrderPos = -1;

let ytProgressTimer = null;
let ytDuration = 0;
let ytIsPlaying = false;


function ytEmptyHTML(title, text) {

  return `
    <div class="empty">
      <div>▶</div>
      <h3>${escapeHTML(title)}</h3>
      <p>${escapeHTML(text)}</p>
    </div>
  `;

}


/* ---------- search ---------- */

ytSearchInput.addEventListener("input", event => {

  const value = event.target.value;

  clearTimeout(ytSearchTimer);

  if (!value.trim()) {
    ytResultsEl.innerHTML = "";
    ytLastResults = [];
    return;
  }

  ytSearchTimer = setTimeout(() => {
    performYtSearch(value);
  }, 450);

});


function ytProxyConfigured() {
  return YT_PROXY_BASE && !YT_PROXY_BASE.includes("your-proxy-url");
}


async function performYtSearch(query) {

  if (!ytProxyConfigured()) {

    showToast("YouTube search isn't set up yet — see server/README.md.");

    ytResultsEl.innerHTML = ytEmptyHTML(
      "Search not configured",
      "The app's search backend hasn't been set up yet."
    );

    return;

  }

  ytResultsEl.innerHTML = ytEmptyHTML("Searching…", "One moment.");

  try {

    const url =
      `${YT_PROXY_BASE}/api/youtube/search` +
      `?q=${encodeURIComponent(query)}&maxResults=15`;

    const response = await fetch(url);

    const data = await response.json().catch(() => null);

    if (!response.ok || !data) {

      const reason = data?.reason || "";

      if (reason.includes("quota")) {
        showToast("YouTube search is temporarily unavailable (quota).");
      } else if (response.status === 429) {
        showToast("Too many searches — try again in a moment.");
      } else {
        showToast("YouTube search failed. Try again.");
      }

      ytResultsEl.innerHTML = ytEmptyHTML(
        "Search failed",
        "Please try again in a moment."
      );

      return;

    }

    ytLastResults = data.items || [];

    renderYtResults();

  } catch (err) {

    showToast("Couldn't reach the search backend. Check your connection.");

    ytResultsEl.innerHTML = ytEmptyHTML(
      "Search failed",
      "Check your connection and try again."
    );

  }

}


function renderYtResults() {

  if (ytLastResults.length === 0) {

    ytResultsEl.innerHTML = ytEmptyHTML(
      "No results",
      "Try a different search."
    );

    return;

  }

  ytResultsEl.innerHTML = ytLastResults.map((video, index) => `
    <div class="yt-track">

      <img
        class="yt-thumb"
        src="${video.thumbnail}"
        alt=""
        loading="lazy"
      >

      <div class="yt-track-main">
        <span class="yt-track-title">${escapeHTML(video.title)}</span>
        <span class="yt-track-channel">${escapeHTML(video.channel)}</span>
      </div>

      <div class="yt-track-actions">
        <button class="yt-play-btn" onclick="ytPlayResult(${index})">▶ Play</button>
        <button onclick="ytAddToQueue(${index})">＋ Queue</button>
        <button onclick="ytOpenAddToPlaylistFromSearch(${index})">☰ Playlist</button>
      </div>

    </div>
  `).join("");

}


/* ---------- embedded playback (official IFrame Player API) ---------- */

window.onYouTubeIframeAPIReady = function() {

  ytPlayer = new YT.Player("ytPlayer", {

    height: "100%",
    width: "100%",

    playerVars: {
      playsinline: 1,
      rel: 0
    },

    events: {

      onReady: () => {

        ytPlayerReady = true;

        if (ytPendingVideoId) {
          ytPlayer.loadVideoById(ytPendingVideoId);
          ytPendingVideoId = null;
        }

      },

      onStateChange: onYtPlayerStateChange,

      onError: () => {
        showToast("This video can't be played right now.");
      }

    }

  });

};


function onYtPlayerStateChange(event) {

  if (event.data === YT.PlayerState.PLAYING) {
    ytOnPlay();
  } else if (event.data === YT.PlayerState.PAUSED) {
    ytOnPause();
  } else if (event.data === YT.PlayerState.ENDED) {
    ytOnEnded();
  } else if (event.data === YT.PlayerState.BUFFERING) {
    document.getElementById("miniSpinner").hidden = false;
    document.getElementById("fullSpinner").hidden = false;
  }

}


/* Load a video and make it the thing the shared mini/full player
   shows and controls. `context`/`contextIndex` describe the list
   this video came from (search results, manual queue, or a
   playlist), so prev/next can walk through it. */
function playYoutubeVideo(video, context, contextIndex, contextLabel = null) {

  // Hand control of the shared mini/full player over from local audio.
  if (!audio.paused) {
    audio.pause();
  }

  setActiveSource("youtube");

  ytContext = context.slice();
  ytContextLabel = contextLabel;
  ytBuildPlayOrder(video);

  const pos = ytPlayOrder.findIndex(i => ytContext[i] && ytContext[i].videoId === video.videoId);
  ytOrderPos = pos > -1 ? pos : 0;

  ytPlayerWrapEl.hidden = false;

  updateYtNowPlayingUI(video);

  if (ytPlayerReady && ytPlayer) {
    ytPlayer.loadVideoById(video.videoId);
  } else {
    ytPendingVideoId = video.videoId;
  }

  renderYtQueueSheet();

}


function updateYtNowPlayingUI(video) {

  document.getElementById("playerTitle").textContent = video.title;
  document.getElementById("playerArtist").textContent = video.channel;

  document.getElementById("fullPlayerTitle").textContent = video.title;
  document.getElementById("fullPlayerArtist").textContent = video.channel;

  document.getElementById("homeNowPlaying").textContent = video.title;
  document.getElementById("homeArtist").textContent = video.channel;

  if (video.thumbnail) {
    miniArtImg.src = video.thumbnail;
    miniArtImg.hidden = false;
    fullArtImg.src = video.thumbnail;
    fullArtImg.hidden = false;
  }

  ytUpdateMediaSession(video);

  // Reset progress display until the player reports real numbers.
  document.getElementById("progress").value = 0;
  miniProgressFill.style.width = "0%";
  document.getElementById("currentTime").textContent = "0:00";
  document.getElementById("duration").textContent = "0:00";
  ytDuration = 0;

}


function ytHideThumbnailArt() {
  miniArtImg.hidden = true;
  fullArtImg.hidden = true;
}


function ytUpdateMediaSession(video) {

  if (!("mediaSession" in navigator)) return;

  try {

    navigator.mediaSession.metadata = new MediaMetadata({
      title: video.title,
      artist: video.channel,
      album: "Mini Music — YouTube",
      artwork: video.thumbnail
        ? [{ src: video.thumbnail, sizes: "120x90", type: "image/jpeg" }]
        : []
    });

  } catch (e) {
    // Ignore if MediaMetadata isn't available.
  }

}


function ytOnPlay() {

  ytIsPlaying = true;

  document.getElementById("playBtn").textContent = "❚❚";
  miniPlayBtn.textContent = "❚❚";

  miniArt.classList.add("spinning");
  fullArt.classList.add("spinning");

  document.getElementById("miniSpinner").hidden = true;
  document.getElementById("fullSpinner").hidden = true;

  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = "playing";
  }

  ytStartProgressPolling();

}


function ytOnPause() {

  ytIsPlaying = false;

  document.getElementById("playBtn").textContent = "▶";
  miniPlayBtn.textContent = "▶";

  miniArt.classList.remove("spinning");
  fullArt.classList.remove("spinning");

  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = "paused";
  }

  ytStopProgressPolling();

}


function ytOnEnded() {

  if (ytRepeatMode === "one") {
    ytPlayer.seekTo(0, true);
    ytPlayer.playVideo();
    return;
  }

  ytPlayNext(true);

}


function ytPauseForHandoff() {

  if (ytPlayer && ytPlayerReady && typeof ytPlayer.pauseVideo === "function") {
    ytPlayer.pauseVideo();
  }

  ytStopProgressPolling();
  ytHideThumbnailArt();

}


function ytTogglePlayPause() {

  if (!ytPlayer || !ytPlayerReady) return;

  if (ytIsPlaying) {
    ytPlayer.pauseVideo();
  } else {
    ytPlayer.playVideo();
  }

}


function ytSeekToPercent(percent) {

  if (!ytPlayer || !ytPlayerReady || !ytDuration) return;

  ytPlayer.seekTo((percent / 100) * ytDuration, true);

}


function ytSeekToSeconds(seconds) {

  if (!ytPlayer || !ytPlayerReady) return;

  ytPlayer.seekTo(seconds, true);

}


function ytStartProgressPolling() {

  ytStopProgressPolling();

  ytProgressTimer = setInterval(() => {

    if (!ytPlayer || typeof ytPlayer.getCurrentTime !== "function") return;

    const current = ytPlayer.getCurrentTime() || 0;
    const duration = ytPlayer.getDuration() || 0;

    if (!duration) return;

    ytDuration = duration;

    const percent = (current / duration) * 100;

    document.getElementById("progress").value = percent;
    miniProgressFill.style.width = percent + "%";

    document.getElementById("currentTime").textContent = formatTime(current);
    document.getElementById("duration").textContent = formatTime(duration);

    if ("mediaSession" in navigator) {

      try {

        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: 1,
          position: Math.min(current, duration)
        });

      } catch (e) {
        // Some browsers throw if called too early; safe to ignore.
      }

    }

  }, 500);

}


function ytStopProgressPolling() {

  if (ytProgressTimer) {
    clearInterval(ytProgressTimer);
    ytProgressTimer = null;
  }

}


window.ytPlayResult = function(index) {

  const video = ytLastResults[index];

  if (!video) return;

  playYoutubeVideo(video, ytLastResults, index);

};


/* ---------- YouTube shuffle / repeat / next / prev ---------- */

function ytBuildPlayOrder(currentVideo = null) {

  ytPlayOrder = ytContext.map((_, i) => i);

  if (ytShuffle) {

    for (let i = ytPlayOrder.length - 1; i > 0; i--) {

      const j = Math.floor(Math.random() * (i + 1));

      [ytPlayOrder[i], ytPlayOrder[j]] = [ytPlayOrder[j], ytPlayOrder[i]];

    }

    if (currentVideo) {

      const curIdx = ytContext.findIndex(v => v.videoId === currentVideo.videoId);
      const pos = ytPlayOrder.indexOf(curIdx);

      if (pos > -1) {
        ytPlayOrder.splice(pos, 1);
        ytPlayOrder.unshift(curIdx);
      }

    }

  }

  if (currentVideo) {

    const curIdx = ytContext.findIndex(v => v.videoId === currentVideo.videoId);
    ytOrderPos = ytPlayOrder.indexOf(curIdx);

  }

  renderYtQueueSheet();

}


function ytPlayNext(auto = false) {

  if (ytContext.length === 0) return;

  if (auto && ytRepeatMode === "one") {
    ytPlayer.seekTo(0, true);
    ytPlayer.playVideo();
    return;
  }

  if (ytOrderPos === -1) ytBuildPlayOrder();

  let nextPos = ytOrderPos + 1;

  if (nextPos >= ytPlayOrder.length) {

    if (auto && ytRepeatMode === "off") {
      ytPlayer && ytPlayer.pauseVideo && ytPlayer.pauseVideo();
      return;
    }

    nextPos = 0;

  }

  ytOrderPos = nextPos;

  const video = ytContext[ytPlayOrder[ytOrderPos]];

  if (!video) return;

  updateYtNowPlayingUI(video);

  if (ytPlayerReady && ytPlayer) {
    ytPlayer.loadVideoById(video.videoId);
  }

  renderYtQueueSheet();

}


function ytPlayPrev() {

  if (ytContext.length === 0) return;

  if (ytOrderPos === -1) ytBuildPlayOrder();

  let prevPos = ytOrderPos - 1;

  if (prevPos < 0) {
    prevPos = ytPlayOrder.length - 1;
  }

  ytOrderPos = prevPos;

  const video = ytContext[ytPlayOrder[ytOrderPos]];

  if (!video) return;

  updateYtNowPlayingUI(video);

  if (ytPlayerReady && ytPlayer) {
    ytPlayer.loadVideoById(video.videoId);
  }

  renderYtQueueSheet();

}


/* ---------- YouTube manual queue (separate from search results) ---------- */

window.ytAddToQueue = function(index) {

  const video = ytLastResults[index];

  if (!video) return;

  ytQueue.push(video);

  renderYtQueue();
  showToast("Added to YouTube queue.");

};


window.ytPlayFromQueue = function(index) {

  const video = ytQueue[index];

  if (!video) return;

  playYoutubeVideo(video, ytQueue, index);

};


window.ytRemoveFromQueue = function(index) {

  ytQueue.splice(index, 1);

  renderYtQueue();

};


function renderYtQueue() {

  ytQueueTitleEl.hidden = ytQueue.length === 0;

  if (ytQueue.length === 0) {
    ytQueueListEl.innerHTML = "";
    return;
  }

  ytQueueListEl.innerHTML = ytQueue.map((video, index) => `
    <div class="yt-track">

      <img
        class="yt-thumb"
        src="${video.thumbnail}"
        alt=""
        loading="lazy"
      >

      <div class="yt-track-main">
        <span class="yt-track-title">${escapeHTML(video.title)}</span>
        <span class="yt-track-channel">${escapeHTML(video.channel)}</span>
      </div>

      <div class="yt-track-actions">
        <button class="yt-play-btn" onclick="ytPlayFromQueue(${index})">▶ Play</button>
        <button onclick="ytOpenAddToPlaylistFromQueue(${index})">☰ Playlist</button>
        <button onclick="ytRemoveFromQueue(${index})">✕ Remove</button>
      </div>

    </div>
  `).join("");

}


/* Renders the "Up next" sheet (the same sheet the local queue uses)
   with whatever list is currently providing YouTube prev/next
   context. */
function renderYtQueueSheet() {

  if (ytContext.length === 0 || ytOrderPos === -1) {

    queueList.innerHTML = `
      <div class="empty">
        <div>▶</div>
        <h3>Queue is empty</h3>
        <p>Play a YouTube video to build your queue.</p>
      </div>
    `;

    return;

  }

  const upcoming = [];

  for (let i = 1; i < ytPlayOrder.length; i++) {

    const pos = (ytOrderPos + i) % ytPlayOrder.length;

    if (pos === ytOrderPos) break;

    upcoming.push({ pos, videoIndex: ytPlayOrder[pos] });

  }

  if (upcoming.length === 0) {

    queueList.innerHTML = `
      <div class="empty">
        <div>▶</div>
        <h3>End of queue</h3>
        <p>${ytRepeatMode !== "off" ? "Playback will repeat." : "Turn on repeat to keep the music going."}</p>
      </div>
    `;

    return;

  }

  queueList.innerHTML = upcoming.map((item, i) => {

    const video = ytContext[item.videoIndex];

    if (!video) return "";

    return `
      <div class="queue-item">

        <span class="queue-num">${i + 1}</span>

        <div class="queue-info">
          <strong>${escapeHTML(video.title)}</strong>
          <small>${escapeHTML(video.channel)}</small>
        </div>

        <button class="queue-play" onclick="ytJumpToQueue(${item.pos})" aria-label="Play now">▶</button>

        <span></span>

      </div>
    `;

  }).join("");

}


window.ytJumpToQueue = function(pos) {

  ytOrderPos = pos;

  const video = ytContext[ytPlayOrder[ytOrderPos]];

  if (!video) return;

  updateYtNowPlayingUI(video);

  if (ytPlayerReady && ytPlayer) {
    ytPlayer.loadVideoById(video.videoId);
  }

  renderYtQueueSheet();

};


/* =========================================================
   YOUTUBE PLAYLIST IMPORT (saved locally in IndexedDB)
========================================================= */

ytImportBtn.addEventListener("click", () => {
  importYtPlaylist();
});

ytPlaylistInput.addEventListener("keydown", event => {

  if (event.key === "Enter") {
    event.preventDefault();
    importYtPlaylist();
  }

});


function ytSetImportLoading(isLoading) {

  const spinner = ytImportBtn.querySelector(".btn-spinner");
  const label = ytImportBtn.querySelector(".btn-label");

  if (!spinner || !label) return;

  ytImportBtn.classList.toggle("is-loading", isLoading);
  spinner.hidden = !isLoading;
  ytImportBtn.disabled = isLoading;

}


async function importYtPlaylist() {

  const value = ytPlaylistInput.value.trim();

  if (!value) {
    showToast("Paste a YouTube playlist link first.");
    return;
  }

  if (!ytProxyConfigured()) {
    showToast("YouTube import isn't set up yet — see server/README.md.");
    return;
  }

  ytSetImportLoading(true);

  try {

    const url =
      `${YT_PROXY_BASE}/api/youtube/playlist` +
      `?url=${encodeURIComponent(value)}`;

    const response = await fetch(url);
    const data = await response.json().catch(() => null);

    if (!response.ok || !data || !data.items) {

      const reason = data?.reason || data?.error || "";

      if (String(reason).toLowerCase().includes("quota")) {
        showToast("YouTube import is temporarily unavailable (quota).");
      } else if (response.status === 429) {
        showToast("Too many requests — try again in a moment.");
      } else if (response.status === 404) {
        showToast("Playlist not found or is private.");
      } else {
        showToast("Couldn't import that playlist. Check the link and try again.");
      }

      return;

    }

    if (data.items.length === 0) {
      showToast("That playlist doesn't have any playable videos.");
      return;
    }

    const playlist = {
      id: data.id,
      title: data.title || "Imported playlist",
      items: data.items,
      addedAt: Date.now()
    };

    await dbAddPlaylist(playlist);

    const existingIdx = ytPlaylists.findIndex(p => p.id === playlist.id);

    if (existingIdx > -1) {
      ytPlaylists[existingIdx] = playlist;
    } else {
      ytPlaylists.unshift(playlist);
    }

    renderYtPlaylists();

    ytPlaylistInput.value = "";

    showToast(`Imported "${playlist.title}" (${playlist.items.length} tracks).`);

  } catch (err) {

    showToast("Couldn't reach the import backend. Check your connection.");

  } finally {

    ytSetImportLoading(false);

  }

}


async function loadYtPlaylists() {

  try {

    const stored = await dbGetAllPlaylists();

    stored.sort((a, b) => b.addedAt - a.addedAt);

    ytPlaylists = stored;

    renderYtPlaylists();

  } catch (err) {
    // No saved playlists yet, or IndexedDB unavailable — non-fatal.
  }

}


function renderYtPlaylists() {

  ytPlaylistsTitleEl.hidden = ytPlaylists.length === 0;

  if (ytPlaylists.length === 0) {
    ytPlaylistsEl.innerHTML = "";
    return;
  }

  ytPlaylistsEl.innerHTML = ytPlaylists.map(playlist => {

    const thumb = playlist.items[0]?.thumbnail;
    const isExpanded = ytExpandedPlaylistId === playlist.id;

    const rowHTML = `
      <div class="yt-playlist" onclick="ytTogglePlaylistExpand('${playlist.id}')">

        ${
          thumb
            ? `<img class="yt-thumb" src="${thumb}" alt="" loading="lazy">`
            : `<div class="yt-playlist-thumb">♫</div>`
        }

        <div class="yt-playlist-main">
          <span class="yt-playlist-title">${escapeHTML(playlist.title)}</span>
          <span class="yt-playlist-count">${playlist.items.length} track${playlist.items.length === 1 ? "" : "s"}</span>
        </div>

        <div class="yt-playlist-actions" onclick="event.stopPropagation()">
          <button class="yt-play-btn" onclick="ytPlayPlaylist('${playlist.id}')">▶ Play</button>
          <button onclick="ytQueuePlaylist('${playlist.id}')">＋ Queue</button>
          <button onclick="ytRefreshPlaylist('${playlist.id}')" id="ytRefreshBtn-${playlist.id}">⟳ Refresh</button>
          <button onclick="ytDeletePlaylist('${playlist.id}')">✕ Remove</button>
        </div>

      </div>
    `;

    const tracksHTML = isExpanded ? `
      <div class="yt-playlist-tracks">
        ${playlist.items.map((video, index) => `
          <div class="yt-track">

            <img class="yt-thumb" src="${video.thumbnail}" alt="" loading="lazy">

            <div class="yt-track-main">
              <span class="yt-track-title">${escapeHTML(video.title)}</span>
              <span class="yt-track-channel">${escapeHTML(video.channel)}</span>
            </div>

            <div class="yt-track-actions">
              <button class="yt-play-btn" onclick="ytPlayPlaylistTrack('${playlist.id}', ${index})">▶ Play</button>
              <button onclick="ytAddPlaylistTrackToQueue('${playlist.id}', ${index})">＋ Queue</button>
              <button onclick="ytOpenAddToPlaylistFromPlaylistTrack('${playlist.id}', ${index})">☰ Playlist</button>
            </div>

          </div>
        `).join("")}
      </div>
    ` : "";

    return rowHTML + tracksHTML;

  }).join("");

}


window.ytTogglePlaylistExpand = function(id) {

  ytExpandedPlaylistId = ytExpandedPlaylistId === id ? null : id;

  renderYtPlaylists();

};


window.ytPlayPlaylist = function(id) {

  const playlist = ytPlaylists.find(p => p.id === id);

  if (!playlist || playlist.items.length === 0) return;

  playYoutubeVideo(playlist.items[0], playlist.items, 0, { type: "playlist", id });

};


window.ytPlayPlaylistTrack = function(id, index) {

  const playlist = ytPlaylists.find(p => p.id === id);

  if (!playlist || !playlist.items[index]) return;

  playYoutubeVideo(playlist.items[index], playlist.items, index, { type: "playlist", id });

};


window.ytQueuePlaylist = function(id) {

  const playlist = ytPlaylists.find(p => p.id === id);

  if (!playlist) return;

  ytQueue.push(...playlist.items);

  renderYtQueue();
  showToast(`Added ${playlist.items.length} tracks to the YouTube queue.`);

};


window.ytAddPlaylistTrackToQueue = function(id, index) {

  const playlist = ytPlaylists.find(p => p.id === id);

  if (!playlist || !playlist.items[index]) return;

  ytQueue.push(playlist.items[index]);

  renderYtQueue();
  showToast("Added to YouTube queue.");

};


window.ytRefreshPlaylist = async function(id) {

  const playlist = ytPlaylists.find(p => p.id === id);

  if (!playlist) return;

  if (!ytProxyConfigured()) {
    showToast("YouTube import isn't set up yet — see server/README.md.");
    return;
  }

  const btn = document.getElementById(`ytRefreshBtn-${id}`);
  const originalLabel = btn ? btn.textContent : "";

  if (btn) {
    btn.textContent = "…";
    btn.disabled = true;
  }

  try {

    const url =
      `${YT_PROXY_BASE}/api/youtube/playlist` +
      `?id=${encodeURIComponent(id)}`;

    const response = await fetch(url);
    const data = await response.json().catch(() => null);

    if (!response.ok || !data || !data.items) {

      const reason = data?.reason || data?.error || "";

      if (String(reason).toLowerCase().includes("quota")) {
        showToast("YouTube refresh is temporarily unavailable (quota).");
      } else if (response.status === 429) {
        showToast("Too many requests — try again in a moment.");
      } else if (response.status === 404) {
        showToast("That playlist is no longer available.");
      } else {
        showToast("Couldn't refresh that playlist. Try again later.");
      }

      return;

    }

    const refreshed = {
      id: data.id,
      title: data.title || playlist.title,
      items: data.items,
      addedAt: playlist.addedAt
    };

    await dbAddPlaylist(refreshed);

    const idx = ytPlaylists.findIndex(p => p.id === id);
    if (idx > -1) ytPlaylists[idx] = refreshed;

    renderYtPlaylists();

    showToast(`Refreshed "${refreshed.title}" (${refreshed.items.length} tracks).`);

  } catch (err) {

    showToast("Couldn't reach the import backend. Check your connection.");

  } finally {

    if (btn) {
      btn.textContent = originalLabel;
      btn.disabled = false;
    }

  }

};


window.ytDeletePlaylist = async function(id) {

  try {

    await dbDeletePlaylist(id);

    ytPlaylists = ytPlaylists.filter(p => p.id !== id);

    if (ytExpandedPlaylistId === id) ytExpandedPlaylistId = null;

    renderYtPlaylists();

  } catch (err) {

    showToast("Couldn't remove that playlist.");

  }

};


/* ---------- add a YouTube song to one of your saved playlists ---------- */

function openAddToPlaylistSheet(video) {

  if (!video) return;

  ytPendingAddSong = video;

  if (ytPlaylists.length === 0) {

    addToPlaylistList.innerHTML = `
      <div class="empty">
        <div>♫</div>
        <h3>No saved playlists yet</h3>
        <p>Import a YouTube playlist first, then you can add songs to it.</p>
      </div>
    `;

  } else {

    addToPlaylistList.innerHTML = ytPlaylists.map(playlist => {

      const thumb = playlist.items[0]?.thumbnail;
      const alreadyIn = playlist.items.some(item => item.videoId === video.videoId);

      return `
        <button class="playlist-pick-item" onclick="ytAddSongToPlaylist('${playlist.id}')">

          ${
            thumb
              ? `<img class="playlist-pick-thumb" src="${thumb}" alt="" loading="lazy">`
              : `<div class="playlist-pick-thumb">♫</div>`
          }

          <div class="playlist-pick-main">
            <strong>${escapeHTML(playlist.title)}</strong>
            <small>${playlist.items.length} track${playlist.items.length === 1 ? "" : "s"}${alreadyIn ? " · already added" : ""}</small>
          </div>

        </button>
      `;

    }).join("");

  }

  addToPlaylistSheet.classList.add("open");

}


function closeAddToPlaylistSheet() {
  addToPlaylistSheet.classList.remove("open");
  ytPendingAddSong = null;
}


addToPlaylistBackdrop.addEventListener("click", closeAddToPlaylistSheet);
closeAddToPlaylistBtn.addEventListener("click", closeAddToPlaylistSheet);


window.ytOpenAddToPlaylistFromSearch = function(index) {
  openAddToPlaylistSheet(ytLastResults[index]);
};


window.ytOpenAddToPlaylistFromQueue = function(index) {
  openAddToPlaylistSheet(ytQueue[index]);
};


window.ytOpenAddToPlaylistFromPlaylistTrack = function(playlistId, index) {

  const playlist = ytPlaylists.find(p => p.id === playlistId);

  if (!playlist || !playlist.items[index]) return;

  openAddToPlaylistSheet(playlist.items[index]);

};


window.ytAddSongToPlaylist = async function(playlistId) {

  const video = ytPendingAddSong;
  const playlist = ytPlaylists.find(p => p.id === playlistId);

  if (!video || !playlist) return;

  if (playlist.items.some(item => item.videoId === video.videoId)) {
    showToast("That song is already in this playlist.");
    closeAddToPlaylistSheet();
    return;
  }

  const updated = {
    ...playlist,
    items: [...playlist.items, video]
  };

  try {

    await dbAddPlaylist(updated);

    const idx = ytPlaylists.findIndex(p => p.id === playlistId);
    if (idx > -1) ytPlaylists[idx] = updated;

    renderYtPlaylists();

    showToast(`Added to "${updated.title}".`);

  } catch (err) {

    showToast("Couldn't save that playlist change.");

  } finally {

    closeAddToPlaylistSheet();

  }

};


loadYtPlaylists();
