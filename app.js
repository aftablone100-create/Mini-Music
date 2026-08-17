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
const DB_VERSION = 1;
const STORE_NAME = "songs";

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


shuffleBtn.addEventListener("click", () => {

  shuffle = !shuffle;

  localStorage.setItem("miniMusicShuffle", JSON.stringify(shuffle));

  shuffleBtn.classList.toggle("active", shuffle);

  buildPlayOrder();
  savePlaybackState();

});


function updateRepeatBtn() {

  repeatBtn.classList.toggle("active", repeatMode !== "off");
  repeatBtn.textContent = repeatMode === "one" ? "🔂" : "🔁";

}


repeatBtn.addEventListener("click", () => {

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

    if (currentIndex === -1) {

      if (songs.length === 0) return;

      if (orderPos === -1) buildPlayOrder();

      loadSong(playOrder[0]);

      return;
    }

    audio.play().catch(() => {});

  });

  navigator.mediaSession.setActionHandler("pause", () => {
    audio.pause();
  });

  navigator.mediaSession.setActionHandler("previoustrack", playPrev);

  navigator.mediaSession.setActionHandler("nexttrack", () => playNext(false));

  navigator.mediaSession.setActionHandler("seekto", details => {

    if (details.seekTime !== undefined && audio.duration) {
      audio.currentTime = details.seekTime;
    }

  });

  navigator.mediaSession.setActionHandler("stop", () => {
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
   YOUTUBE — STEP 1: SEARCH + OFFICIAL EMBEDDED PLAYBACK
   -----------------------------------------------------------
   This block is intentionally self-contained. It does not read
   or write any of the local-playback variables above (songs,
   currentIndex, playOrder, orderPos, shuffle, repeatMode, etc.)
   and does not touch the local mini-player / full-player / queue
   sheet. YouTube videos are streamed only through the official
   YouTube IFrame Player API — nothing is downloaded, extracted,
   or cached.
========================================================= */

/* =========================================================
   YOUTUBE — STEP 1: SEARCH + OFFICIAL EMBEDDED PLAYBACK
   -----------------------------------------------------------
   This block is intentionally self-contained. It does not read
   or write any of the local-playback variables above (songs,
   currentIndex, playOrder, orderPos, shuffle, repeatMode, etc.)
   and does not touch the local mini-player / full-player / queue
   sheet. YouTube videos are streamed only through the official
   YouTube IFrame Player API — nothing is downloaded, extracted,
   or cached.

   Search requests go through a server-side proxy (see /server) so
   the YouTube Data API v3 key stays off the client entirely. The
   user never enters, sees, or stores an API key anywhere in this
   app.
========================================================= */

// EDIT ME: point this at wherever you deploy the proxy in /server.
// e.g. "https://mini-music-proxy.onrender.com"
const YT_PROXY_BASE = "https://your-proxy-url.example.com";

const ytSearchBox = document.getElementById("ytSearchBox");
const ytSearchInput = document.getElementById("ytSearchInput");
const ytResultsEl = document.getElementById("ytResults");
const ytQueueTitleEl = document.getElementById("ytQueueTitle");
const ytQueueListEl = document.getElementById("ytQueueList");
const ytPlayerWrapEl = document.getElementById("ytPlayerWrap");
const ytNowTitleEl = document.getElementById("ytNowTitle");
const ytNowChannelEl = document.getElementById("ytNowChannel");

let ytLastResults = [];
let ytQueue = [];
let ytSearchTimer = null;

let ytPlayer = null;
let ytPlayerReady = false;
let ytPendingVideoId = null;


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


async function performYtSearch(query) {

  if (!YT_PROXY_BASE || YT_PROXY_BASE.includes("your-proxy-url")) {

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

      onError: () => {
        showToast("This video can't be played right now.");
      }

    }

  });

};


function playYoutubeVideo(video) {

  ytPlayerWrapEl.hidden = false;

  ytNowTitleEl.textContent = video.title;
  ytNowChannelEl.textContent = video.channel;

  if (ytPlayerReady && ytPlayer) {
    ytPlayer.loadVideoById(video.videoId);
  } else {
    ytPendingVideoId = video.videoId;
  }

}


window.ytPlayResult = function(index) {

  const video = ytLastResults[index];

  if (!video) return;

  playYoutubeVideo(video);

};


/* ---------- YouTube queue (separate from the local queue) ---------- */

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

  playYoutubeVideo(video);

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
        <button onclick="ytRemoveFromQueue(${index})">✕ Remove</button>
      </div>

    </div>
  `).join("");

}
