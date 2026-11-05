// The Lucid Universe: a NASA Space Explorer.
// Fetches Astronomy Picture of the Day (APOD) entries for a chosen date range,
// shows them full screen one at a time, and keeps a gallery and a details
// pop-up (modal) for every entry.

// =====================================================================
// 1. NASA APOD API
// =====================================================================
// NASA moved APOD to a new WordPress endpoint in September 2026. The old
// api.nasa.gov/planetary/apod address is being retired (December 1, 2026) and
// was returning a placeholder entry ("NASA Science" + logo) for every day.
// The new endpoint is public: no API key is needed, so none is stored here.
const APOD_URL = 'https://science.nasa.gov/wp-json/wp/v2/apod-basic';
const FIRST_APOD = '1995-06-16';
const PAGE_SIZE = 25; // the most entries the endpoint returns per request
const MAX_RANGE_DAYS = 31; // keeps each search quick and light on NASA's servers

// =====================================================================
// 2. Page elements
// =====================================================================
const $ = (id) => document.getElementById(id);

const startInput = $('startDate');
const endInput = $('endDate');

// Call the setupDateInputs function from dateRange.js
// This sets up the date pickers to:
// - Default to a range of 9 days (from 9 days ago to today)
// - Restrict dates to NASA's image archive (starting from 1995)
setupDateInputs(startInput, endInput);

const body = document.body;
const intro = $('intro');
const app = $('app');
const stage = $('stage');
const layers = [...stage.querySelectorAll('.scene')];
const statusBox = $('status');
const caption = $('caption');
const captionTitle = $('captionTitle');
const captionDate = $('captionDate');
const captionPos = $('captionPos');
const gallery = $('gallery');
const galleryRange = $('galleryRange');
const galleryPos = $('galleryPos');
const dateForm = $('dateForm');
const getButton = $('getImages');
const dateMessage = $('dateMessage');
const modal = $('modal');
const modalMedia = $('modalMedia');
const modalTitle = $('modalTitle');
const modalDate = $('modalDate');
const modalExplanation = $('modalExplanation');
const modalCredit = $('modalCredit');
const modalLinks = $('modalLinks');
const factToast = $('factToast');

// =====================================================================
// 3. LevelUp: random "Did You Know?" space fact
// =====================================================================
// A small curated list written for this project (not quoted from NASA).
const spaceFacts = [
  'A day on Venus is longer than its year: it spins once every 243 Earth days but orbits the Sun in about 225.',
  'A teaspoon of neutron star material would weigh roughly a billion tons on Earth.',
  'Sunlight takes about 8 minutes and 20 seconds to reach Earth.',
  'The footprints left on the Moon by Apollo astronauts could last for millions of years because the Moon has no wind or rain.',
  'Jupiter\'s Great Red Spot is a storm wider than Earth that people have watched for more than 150 years.',
  'Saturn is less dense than water. In a big enough bathtub, it would float.',
  'The International Space Station circles Earth about 16 times a day.',
  'Olympus Mons on Mars is about two and a half times as tall as Mount Everest.',
  'About 1.3 million Earths could fit inside the Sun.',
  'One year on Neptune lasts about 165 Earth years.',
  'When you look at the Andromeda galaxy, you see light that left it about 2.5 million years ago.'
];

const randomFact = spaceFacts[Math.floor(Math.random() * spaceFacts.length)];
$('factText').textContent = randomFact;

// =====================================================================
// 4. Settings (saved in this browser only)
// =====================================================================
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const SETTINGS_KEY = 'lucid-universe-settings';

function loadSettings() {
  const defaults = { mode: 'immersive', motion: reducedMotionQuery.matches ? 'off' : 'subtle', cursor: true, motionChosen: false };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const settings = { ...defaults, ...saved };
    // Follow the device's reduced-motion setting unless the user picked a motion level
    if (!settings.motionChosen && reducedMotionQuery.matches) settings.motion = 'off';
    return settings;
  } catch (error) {
    return defaults;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    // Private windows can block storage. The app still works without it.
  }
}

const settings = loadSettings();

// How long each part of a transition takes (ms) at each motion level
const MOTION = {
  off: { out: 0, in: 180, drift: 0, overscan: 1 },
  subtle: { out: 650, in: 950, drift: 1, overscan: 1.06 },
  cinematic: { out: 950, in: 1400, drift: 2.2, overscan: 1.12 }
};

// =====================================================================
// 5. App state
// =====================================================================
let entries = []; // normalized APOD entries currently in the gallery
let currentIndex = -1;
let activeLayer = 0; // which of the two scene layers is showing
let travelToken = 0; // increases on every navigation so stale loads are ignored
let searchController = null; // lets a new search cancel the old one
let archiveTotal = 0; // how many APOD entries exist (for random picks)
const responseCache = new Map();

// =====================================================================
// 6. Dates
// =====================================================================
// NASA publishes on US Eastern time. In the evening (US time) the browser's
// "today" in UTC can already be tomorrow, so we never ask for a date later
// than today's date in New York.
function nasaToday() {
  // 'en-CA' formats dates as YYYY-MM-DD
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

function daysBetween(start, end) {
  return Math.round((new Date(`${end}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000);
}

// The new endpoint wants dates as YYMMDD, for example 2026-11-04 becomes 261104
function toApiDate(dateString) {
  return dateString.replace(/-/g, '').slice(2);
}

// Turn "2026-10-30" into "October 30, 2026"
function formatDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Read the inputs. If the end date is past NASA's "today", slide the range back
// so we still get the same number of days.
function getDateRange() {
  let startDate = startInput.value;
  let endDate = endInput.value;
  const latest = nasaToday();

  if (endDate > latest) {
    const shift = daysBetween(latest, endDate);
    endDate = latest;
    startDate = addDays(startDate, -shift);
  }
  if (startDate < FIRST_APOD) startDate = FIRST_APOD;
  return { startDate, endDate };
}

// Returns an error message, or '' when the range is fine
function checkRange(startDate, endDate) {
  if (!startDate || !endDate) return 'Please choose both a start date and an end date.';
  if (startDate > endDate) return 'Please choose a start date that is before the end date.';
  if (daysBetween(startDate, endDate) + 1 > MAX_RANGE_DAYS) {
    return `Please choose ${MAX_RANGE_DAYS} days or fewer at a time.`;
  }
  return '';
}

// =====================================================================
// 7. Fetching data
// =====================================================================
class ApiError extends Error {}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fetch one URL and return { data, total }. Retries once on network trouble,
// server errors and rate limits. Throws ApiError with a friendly message.
async function getJson(url, signal) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal });

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('Retry-After')) || 1.5;
        lastError = new ApiError(response.status === 429
          ? 'NASA\'s service is getting too many requests right now. Please wait a minute and try again.'
          : 'NASA\'s service is having trouble right now. Please try again in a moment.');
        if (attempt === 0) {
          await wait(Math.min(retryAfter, 5) * 1000);
          continue;
        }
        throw lastError;
      }

      // Read as text first: some entries contain stray control characters
      // that make the browser's JSON parser fail.
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        data = JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' '));
      }

      if (!response.ok) {
        throw new ApiError(data && data.message
          ? `NASA could not answer that request (${data.message}).`
          : `NASA could not answer that request (error ${response.status}).`);
      }
      return { data, total: Number(response.headers.get('X-WP-Total')) || 0 };
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof ApiError) throw error;
      lastError = new ApiError(navigator.onLine === false
        ? 'You seem to be offline. Check your connection and try again.'
        : 'Could not reach NASA\'s servers. Please check your connection and try again.');
      if (attempt === 0) await wait(1200);
    }
  }
  throw lastError;
}

// Cache answers for 30 minutes so going back to a range is instant
function cacheGet(key) {
  if (responseCache.has(key)) return responseCache.get(key);
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (saved && Date.now() - saved.time < 30 * 60 * 1000) {
      responseCache.set(key, saved.items);
      return saved.items;
    }
  } catch (error) { /* storage blocked or full */ }
  return null;
}

function cacheSet(key, items) {
  responseCache.set(key, items);
  try {
    sessionStorage.setItem(key, JSON.stringify({ time: Date.now(), items }));
  } catch (error) { /* storage blocked or full: memory cache still works */ }
}

// All entries from startDate to endDate, newest first
async function fetchRange(startDate, endDate, signal) {
  const key = `apod:${startDate}:${endDate}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const params = `date_from=${toApiDate(startDate)}&date_to=${toApiDate(endDate)}&per_page=${PAGE_SIZE}`;
  const first = await getJson(`${APOD_URL}?${params}&page=1`, signal);
  let raw = Array.isArray(first.data) ? first.data : [];

  // Ranges longer than 25 days come back in more than one page
  const pages = Math.ceil(first.total / PAGE_SIZE);
  for (let page = 2; page <= pages; page++) {
    const next = await getJson(`${APOD_URL}?${params}&page=${page}`, signal);
    if (Array.isArray(next.data)) raw = raw.concat(next.data);
  }

  const items = raw.map(normalizeEntry).filter(Boolean).sort((a, b) => (a.date < b.date ? 1 : -1));
  cacheSet(key, items);
  return items;
}

// Random entries from the whole archive. The new endpoint has no "random"
// option, so we pick random page numbers (one entry per page).
async function fetchRandom(count, signal) {
  if (!archiveTotal) {
    const probe = await getJson(`${APOD_URL}?per_page=1`, signal);
    archiveTotal = probe.total || 11000;
  }
  const pages = new Set();
  while (pages.size < count) pages.add(1 + Math.floor(Math.random() * archiveTotal));

  const results = await Promise.all([...pages].map((page) =>
    getJson(`${APOD_URL}?per_page=1&page=${page}`, signal).then((r) => r.data[0]).catch((error) => {
      if (error.name === 'AbortError') throw error;
      return null; // skip one failed pick instead of failing them all
    })
  ));
  const items = results.map(normalizeEntry).filter(Boolean);
  if (!items.length) throw new ApiError('Could not reach NASA\'s servers. Please try again.');
  return items;
}

// =====================================================================
// 8. Making each entry consistent (normalizing)
// =====================================================================
// The API's `url` is the article page, not a picture, so we never show it as
// an image. Pictures come from `hdurl`. Videos are found inside `basic_html`.
const PLACEHOLDER_IMAGE = /\/images\/misc\/news-thumbnail\.|nasa-logo/i;
const VIDEO_FILE_HOSTS = ['assets.science.nasa.gov', 'apod.nasa.gov', 'science.nasa.gov'];

function safeUrl(value, base = 'https://science.nasa.gov/') {
  try {
    const url = new URL(String(value).trim(), base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch (error) {
    return null;
  }
}

// Read the width and height NASA puts in the hdurl (?w=4144&h=2822)
function sizeFromUrl(url) {
  const parsed = safeUrl(url);
  if (!parsed) return null;
  const width = Number(parsed.searchParams.get('w'));
  const height = Number(parsed.searchParams.get('h'));
  return width > 0 && height > 0 ? { width, height } : null;
}

// Turn YouTube and Vimeo links into privacy-friendly embed addresses.
// Returns null for anything we do not trust inside an iframe.
function toEmbedUrl(value) {
  const url = safeUrl(value, 'https://www.youtube.com/');
  if (!url) return null;
  const host = url.hostname.replace(/^www\./, '');
  let id = null;
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = (url.pathname.match(/\/embed\/([\w-]{6,})/) || [])[1] || url.searchParams.get('v');
    if (id) return { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}?rel=0`, link: `https://www.youtube.com/watch?v=${id}` };
  }
  if (host === 'youtu.be') {
    id = url.pathname.slice(1);
    if (id) return { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}?rel=0`, link: `https://www.youtube.com/watch?v=${id}` };
  }
  if (host === 'player.vimeo.com' || host === 'vimeo.com') {
    id = (url.pathname.match(/(\d{5,})/) || [])[1];
    if (id) return { kind: 'vimeo', src: `https://player.vimeo.com/video/${id}`, link: `https://vimeo.com/${id}` };
  }
  return null;
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date || '')) return null;

  // basic_html is NASA's full page for the day. DOMParser builds it as an
  // inert document: nothing in it runs or loads.
  const page = raw.basic_html ? new DOMParser().parseFromString(String(raw.basic_html), 'text/html') : null;

  // --- Picture ---
  let image = null;
  const hd = safeUrl(raw.hdurl || '');
  if (hd && !PLACEHOLDER_IMAGE.test(hd.pathname)) {
    image = hd.href;
  } else if (page) {
    // Older entries (like 1995) only have the real picture inside basic_html
    const tag = page.querySelector('img[src]');
    const link = [...page.querySelectorAll('a[href]')].find((a) => /\.(jpe?g|png|gif|webp)$/i.test(a.getAttribute('href')));
    const found = safeUrl((tag && tag.getAttribute('src')) || (link && link.getAttribute('href')) || '');
    if (found && !PLACEHOLDER_IMAGE.test(found.pathname)) image = found.href;
  }

  // --- Video ---
  let video = null;
  if (page) {
    const source = page.querySelector('video source[src], video[src]');
    const file = source && safeUrl(source.getAttribute('src'));
    if (file && VIDEO_FILE_HOSTS.includes(file.hostname)) {
      video = { kind: 'file', src: file.href, link: file.href };
    } else {
      const frame = page.querySelector('iframe[src]');
      if (frame) {
        const src = frame.getAttribute('src');
        const external = safeUrl(src, 'https://www.youtube.com/');
        video = toEmbedUrl(src) || (external ? { kind: 'external', src: null, link: external.href } : null);
      }
    }
  }

  let type = 'other';
  if (raw.media_type === 'image' && image) type = 'image';
  else if (video && video.kind === 'file') type = 'video';
  else if (video && video.src) type = 'embed';
  else if (image && raw.media_type !== 'video') type = 'image';

  const title = htmlToText(raw.title) || 'Untitled';
  const permalink = (safeUrl(raw.permalink || raw.url || '') || {}).href || 'https://science.nasa.gov/apod/';
  const alt = htmlToText(raw.alt);

  return {
    id: raw.post_id || raw.date,
    date: raw.date,
    title,
    type, // 'image' | 'video' | 'embed' | 'other'
    image, // full-size picture (or video poster) or null
    size: sizeFromUrl(raw.hdurl),
    video,
    permalink,
    alt: alt && !/^see explanation/i.test(alt) ? alt : `${title}, NASA Astronomy Picture of the Day for ${formatDate(raw.date)}`,
    explanation: String(raw.explanation || '').replace(/^\s*<(strong|b)>\s*Explanation:?\s*<\/\1>\s*/i, ''),
    credit: String(raw.credit || ''),
    copyright: String(raw.copyright || '')
  };
}

// =====================================================================
// 9. Showing NASA's text safely
// =====================================================================
// The explanation and credit fields contain HTML. We never insert it
// directly. Instead we rebuild it, keeping only simple formatting and links.
const ALLOWED_TAGS = new Set(['A', 'B', 'STRONG', 'EM', 'I', 'BR', 'P', 'SUP', 'SUB', 'SPAN']);
const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'IMG', 'VIDEO', 'AUDIO']);

function safeHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const fragment = document.createDocumentFragment();

  function copyChildren(from, to) {
    from.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        to.appendChild(document.createTextNode(node.textContent));
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (DROPPED_TAGS.has(node.tagName)) return;
        if (!ALLOWED_TAGS.has(node.tagName)) {
          copyChildren(node, to); // keep the text, lose the tag
          return;
        }
        const clean = document.createElement(node.tagName === 'SPAN' ? 'span' : node.tagName.toLowerCase());
        if (node.tagName === 'A') {
          const url = safeUrl(node.getAttribute('href') || '');
          if (!url) {
            copyChildren(node, to);
            return;
          }
          clean.href = url.href;
          clean.target = '_blank';
          clean.rel = 'noopener noreferrer';
        }
        copyChildren(node, clean);
        to.appendChild(clean);
      }
    });
  }

  copyChildren(doc.body, fragment);
  return fragment;
}

function htmlToText(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return doc.body.textContent.replace(/\s+/g, ' ').trim();
}

// =====================================================================
// 10. Image sizes
// =====================================================================
// Full-size APOD images can be over 25 MB. NASA's image server resizes when
// given ?w= (the hdurl itself uses this), so we ask for only what the screen
// needs. If a resized copy ever fails, we fall back to the original.
function sizedUrl(src, width) {
  const url = safeUrl(src || '');
  if (!url || url.hostname !== 'assets.science.nasa.gov' || /\.gif$/i.test(url.pathname)) return src;
  if (url.pathname.startsWith('/content/dam/')) {
    url.pathname = `/dynamicimage/assets${url.pathname.slice('/content/dam'.length)}`;
  }
  const original = Number(url.searchParams.get('w')) || Infinity;
  url.search = '';
  url.searchParams.set('w', String(Math.round(Math.min(width, original))));
  url.searchParams.set('fit', 'clip');
  return url.href;
}

// Pick a width for the main view, rounded so the browser can reuse downloads
function stageWidth(entry, forExplore) {
  // Phones get a lighter copy: their screens are small and data can be slow
  const small = Math.min(window.innerWidth, window.innerHeight) < 820;
  const ratio = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
  const cap = small ? 1792 : 2560;
  if (forExplore) return small ? 2048 : 2560;
  const aspect = entry.size ? entry.size.width / entry.size.height : 1.5;
  const coverWidth = settings.mode === 'original' ? window.innerWidth : Math.max(window.innerWidth, window.innerHeight * aspect);
  return Math.min(cap, Math.ceil((coverWidth * ratio * 1.1) / 256) * 256);
}

// Load an image, trying each address in order. Resolves with the <img>.
function loadImage(sources) {
  return new Promise((resolve, reject) => {
    const list = [...new Set(sources.filter(Boolean))];
    const img = new Image();
    img.decoding = 'async';
    let i = 0;
    img.onload = () => {
      (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => resolve(img));
    };
    img.onerror = () => {
      i += 1;
      if (i < list.length) img.src = list[i];
      else reject(new Error('image failed'));
    };
    if (!list.length) reject(new Error('no image'));
    else img.src = list[0];
  });
}

const preloaded = new Set();
function preload(entry) {
  if (!entry || !entry.image || entry.type !== 'image') return;
  const src = sizedUrl(entry.image, stageWidth(entry));
  if (preloaded.has(src)) return;
  preloaded.add(src);
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
}

// =====================================================================
// 11. Star field background
// =====================================================================
const stars = (() => {
  const canvas = $('stars');
  const ctx = canvas.getContext('2d');
  let points = [];
  let running = false;
  let warp = 0; // extra speed during transitions
  let last = 0;
  let width = 0;
  let height = 0;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.round(Math.min(320, (width * height) / 5200));
    points = Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: Math.random() * 0.9 + 0.1,
      tone: Math.random()
    }));
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    const cx = width / 2;
    const cy = height / 2;
    const spread = Math.max(width, height) * 0.6;
    for (const p of points) {
      const sx = cx + (p.x / p.z) * spread * 0.5;
      const sy = cy + (p.y / p.z) * spread * 0.5;
      if (sx < -4 || sx > width + 4 || sy < -4 || sy > height + 4) continue;
      const size = Math.max(0.35, (1.1 - p.z) * 1.6);
      ctx.globalAlpha = Math.min(1, (1.1 - p.z) * 0.95);
      ctx.fillStyle = p.tone > 0.85 ? '#ffd9c4' : p.tone > 0.7 ? '#cfe0ff' : '#ffffff';
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Stars only need to move when they can be seen
  function needed() {
    if (settings.motion === 'off' || document.hidden) return false;
    return body.classList.contains('is-intro') || warp > 0.001 || settings.mode !== 'immersive' || (entries[currentIndex] && entries[currentIndex].type !== 'image');
  }

  function frame(time) {
    if (!needed()) {
      running = false;
      return;
    }
    const dt = Math.min(0.05, (time - (last || time)) / 1000);
    last = time;
    const speed = 0.012 * MOTION[settings.motion].drift + warp;
    for (const p of points) {
      p.z -= speed * dt;
      if (p.z <= 0.08) {
        p.z = 1;
        p.x = (Math.random() - 0.5) * 2;
        p.y = (Math.random() - 0.5) * 2;
      }
    }
    warp *= Math.pow(0.12, dt); // ease the burst back down
    draw();
    requestAnimationFrame(frame);
  }

  function wake() {
    if (running || !needed()) return;
    running = true;
    last = 0;
    requestAnimationFrame(frame);
  }

  function burst(amount) {
    warp = Math.max(warp, amount);
    wake();
  }

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', wake);
  resize();
  return { wake, burst, draw };
})();

// =====================================================================
// 12. The camera: moving and zooming the photo
// =====================================================================
// Each scene layer keeps its own camera. x and y are offsets from center in
// screen pixels, s is the scale. "t" values are targets we ease toward.
function newCamera(width, height) {
  return { w: width, h: height, s: 1, x: 0, y: 0, ts: 1, tx: 0, ty: 0, min: 1, max: 1 };
}

let cameraRunning = false;
let lastCameraTime = 0;

function activeScene() {
  return layers[activeLayer];
}

function stageSize() {
  return { W: stage.clientWidth || window.innerWidth, H: stage.clientHeight || window.innerHeight };
}

// How far the image can move before an edge would show
function panLimits(cam, scale) {
  const { W, H } = stageSize();
  return { x: Math.max(0, (cam.w * scale - W) / 2), y: Math.max(0, (cam.h * scale - H) / 2) };
}

function clampCamera(cam) {
  cam.ts = Math.min(cam.max, Math.max(cam.min, cam.ts));
  const limit = panLimits(cam, cam.ts);
  cam.tx = Math.min(limit.x, Math.max(-limit.x, cam.tx));
  cam.ty = Math.min(limit.y, Math.max(-limit.y, cam.ty));
}

// Work out the starting scale for the current mode
function fitCamera(cam, keepPosition = false) {
  const { W, H } = stageSize();
  const contain = Math.min(W / cam.w, H / cam.h);
  const cover = Math.max(W / cam.w, H / cam.h);
  const lookAround = settings.cursor && settings.motion !== 'off';

  if (settings.mode === 'immersive') {
    cam.min = cam.max = cover * (lookAround ? MOTION[settings.motion].overscan : 1);
  } else if (settings.mode === 'original') {
    cam.min = cam.max = contain;
  } else {
    cam.min = contain;
    cam.max = Math.max(contain * 6, 1.5);
  }
  if (!keepPosition) {
    cam.ts = cam.min;
    cam.tx = 0;
    cam.ty = 0;
  }
  clampCamera(cam);
}

function renderCamera(layer) {
  const cam = layer.camera;
  const img = layer.querySelector('.scene-img');
  if (!cam || !img) return;
  const { W, H } = stageSize();
  const left = W / 2 - (cam.w * cam.s) / 2 + cam.x;
  const top = H / 2 - (cam.h * cam.s) / 2 + cam.y;
  img.style.transform = `translate3d(${left}px, ${top}px, 0) scale(${cam.s})`;
}

// Ease the camera toward its target. Stops itself when it arrives.
function cameraFrame(time) {
  const layer = activeScene();
  const cam = layer.camera;
  if (!cam) {
    cameraRunning = false;
    return;
  }
  const dt = Math.min(0.05, (time - (lastCameraTime || time)) / 1000);
  lastCameraTime = time;
  const speed = settings.motion === 'off' ? 1 : 1 - Math.exp(-dt * (settings.mode === 'explore' ? 14 : settings.motion === 'cinematic' ? 2.6 : 3.6));

  cam.s += (cam.ts - cam.s) * speed;
  cam.x += (cam.tx - cam.x) * speed;
  cam.y += (cam.ty - cam.y) * speed;

  // Never show a gap past the edge, even mid-animation
  const limit = panLimits(cam, cam.s);
  cam.x = Math.min(limit.x, Math.max(-limit.x, cam.x));
  cam.y = Math.min(limit.y, Math.max(-limit.y, cam.y));
  renderCamera(layer);

  const settled = Math.abs(cam.ts - cam.s) < 0.0005 && Math.abs(cam.tx - cam.x) < 0.2 && Math.abs(cam.ty - cam.y) < 0.2;
  if (settled) {
    cam.s = cam.ts;
    cam.x = cam.tx;
    cam.y = cam.ty;
    renderCamera(layer);
    cameraRunning = false;
    return;
  }
  requestAnimationFrame(cameraFrame);
}

function moveCamera() {
  if (cameraRunning) return;
  cameraRunning = true;
  lastCameraTime = 0;
  requestAnimationFrame(cameraFrame);
}

function resetView() {
  const cam = activeScene().camera;
  if (!cam) return;
  fitCamera(cam);
  moveCamera();
}

// Zoom around a point on screen (used by wheel, pinch and double click)
function zoomAt(factor, clientX, clientY) {
  const cam = activeScene().camera;
  if (!cam || settings.mode !== 'explore') return;
  const rect = stage.getBoundingClientRect();
  const px = clientX - rect.left - rect.width / 2;
  const py = clientY - rect.top - rect.height / 2;
  const oldScale = cam.ts;
  cam.ts = Math.min(cam.max, Math.max(cam.min, oldScale * factor));
  const change = cam.ts / oldScale;
  cam.tx = px - (px - cam.tx) * change;
  cam.ty = py - (py - cam.ty) * change;
  clampCamera(cam);
  moveCamera();
}

// --- Cursor look-around (Immersive mode) ---
// Listen on the whole app so the arrows and caption don't block it. Panels
// are skipped so the picture holds still while you use them.
app.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse' || settings.mode !== 'immersive' || !settings.cursor || settings.motion === 'off') return;
  if (event.target.closest('.panel, .rail')) return;
  const cam = activeScene().camera;
  if (!cam) return;
  const rect = stage.getBoundingClientRect();
  // -1 at the left/top edge, +1 at the right/bottom edge
  const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
  const limit = panLimits(cam, cam.ts);
  // Moving toward the right shows more of the right side of the photo
  cam.tx = -nx * limit.x;
  cam.ty = -ny * limit.y;
  moveCamera();
});

// --- Drag, pinch and swipe ---
const pointers = new Map();
let dragStart = null;
let pinchStart = null;

stage.addEventListener('pointerdown', (event) => {
  if (event.target.closest('button, a, video, iframe')) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const cam = activeScene().camera;
  dragStart = { x: event.clientX, y: event.clientY, tx: cam ? cam.tx : 0, ty: cam ? cam.ty : 0, time: performance.now() };
  if (pointers.size === 2 && cam) {
    const [a, b] = [...pointers.values()];
    pinchStart = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: cam.ts };
  }
  if (settings.mode === 'explore') {
    try {
      stage.setPointerCapture(event.pointerId);
    } catch (error) {
      // Some browsers refuse capture for certain touches. Dragging still works.
    }
  }
});

stage.addEventListener('pointermove', (event) => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const cam = activeScene().camera;
  if (!cam || settings.mode !== 'explore') return;

  if (pointers.size === 2 && pinchStart) {
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const target = pinchStart.scale * (distance / pinchStart.distance);
    zoomAt(target / cam.ts, (a.x + b.x) / 2, (a.y + b.y) / 2);
    return;
  }
  if (dragStart) {
    stage.classList.add('is-dragging');
    cam.tx = dragStart.tx + (event.clientX - dragStart.x);
    cam.ty = dragStart.ty + (event.clientY - dragStart.y);
    clampCamera(cam);
    moveCamera();
  }
});

function endPointer(event) {
  if (!pointers.has(event.pointerId)) return;
  pointers.delete(event.pointerId);
  stage.classList.remove('is-dragging');
  if (pointers.size < 2) pinchStart = null;

  // A quick sideways swipe changes photos (when not exploring)
  if (dragStart && settings.mode !== 'explore' && event.pointerType !== 'mouse') {
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 60 && performance.now() - dragStart.time < 600) {
      step(dx < 0 ? 1 : -1);
    }
  }
  if (pointers.size === 0) dragStart = null;
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

stage.addEventListener('wheel', (event) => {
  if (settings.mode !== 'explore') return;
  event.preventDefault();
  zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
}, { passive: false });

stage.addEventListener('dblclick', (event) => {
  if (event.target.closest('button, a, video, iframe')) return;
  if (settings.mode !== 'explore') {
    setMode('explore');
    return;
  }
  const cam = activeScene().camera;
  if (cam && cam.ts >= cam.max * 0.98) resetView();
  else zoomAt(2, event.clientX, event.clientY);
});

window.addEventListener('resize', () => {
  layers.forEach((layer) => {
    if (layer.camera) {
      fitCamera(layer.camera, settings.mode === 'explore');
      layer.camera.s = layer.camera.ts;
      layer.camera.x = layer.camera.tx;
      layer.camera.y = layer.camera.ty;
      renderCamera(layer);
    }
  });
});

// =====================================================================
// 13. Scenes and dreamlike transitions
// =====================================================================
function showStatus(text, retry) {
  statusBox.textContent = '';
  if (!text) {
    statusBox.hidden = true;
    return;
  }
  const message = document.createElement('span');
  message.textContent = text;
  statusBox.appendChild(message);
  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = 'Try again';
    button.addEventListener('click', retry);
    statusBox.appendChild(button);
  }
  statusBox.hidden = false;
}

// Build what goes inside a scene for one entry
async function buildScene(entry, token) {
  const inner = document.createElement('div');
  inner.className = 'scene-inner';

  if (entry.type === 'image') {
    const big = entry.image;
    const sharpSrc = sizedUrl(big, stageWidth(entry, settings.mode === 'explore'));
    let img;
    try {
      // Show the small gallery copy first (usually already downloaded),
      // then swap in the sharp one. Phones see a picture right away.
      img = await loadImage([sizedUrl(big, 480)]);
    } catch (error) {
      img = await loadImage([sharpSrc, big]);
    }
    if (token !== travelToken) return null;
    if (img.src !== sharpSrc) {
      img.classList.add('is-soft');
      loadImage([sharpSrc, big]).then((sharp) => {
        if (document.contains(img) || token === travelToken) {
          img.src = sharp.src;
          img.classList.remove('is-soft');
        }
      }).catch(() => img.classList.remove('is-soft'));
    }
    img.className = `scene-img${img.classList.contains('is-soft') ? ' is-soft' : ''}`;
    img.alt = entry.alt;
    img.draggable = false;
    const width = entry.size ? entry.size.width : img.naturalWidth;
    const height = entry.size ? entry.size.height : img.naturalHeight;
    img.style.width = `${width}px`;
    img.style.height = `${height}px`;
    inner.appendChild(img);
    return { inner, camera: newCamera(width, height) };
  }

  // Videos and other media sit centered without the camera
  const box = document.createElement('div');
  box.className = 'scene-video';

  if (entry.type === 'video') {
    const video = document.createElement('video');
    video.src = entry.video.src;
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    if (entry.image) video.poster = sizedUrl(entry.image, 1600);
    video.setAttribute('aria-label', entry.title);
    box.appendChild(video);
  } else {
    // Embedded (YouTube/Vimeo) videos show a poster first. The player only
    // loads when the viewer asks for it, so nothing plays by itself.
    if (entry.image) {
      const poster = document.createElement('img');
      poster.src = sizedUrl(entry.image, 1600);
      poster.alt = entry.alt;
      poster.className = 'scene-poster';
      box.appendChild(poster);
    }
    const action = document.createElement(entry.type === 'embed' ? 'button' : 'a');
    action.className = 'play-button';
    if (entry.type === 'embed') {
      action.type = 'button';
      action.innerHTML = '<span aria-hidden="true">▶</span> Play video';
      action.addEventListener('click', () => {
        box.textContent = '';
        box.appendChild(makeIframe(entry, true));
      });
    } else {
      action.href = (entry.video && entry.video.link) || entry.permalink;
      action.target = '_blank';
      action.rel = 'noopener noreferrer';
      action.textContent = entry.video ? 'Watch this video on its original site ↗' : 'View this entry on NASA\'s site ↗';
    }
    box.appendChild(action);
  }
  inner.appendChild(box);
  return { inner, camera: null };
}

function makeIframe(entry, autoplay) {
  const frame = document.createElement('iframe');
  frame.src = entry.video.src + (autoplay ? '&autoplay=1' : '');
  if (entry.video.kind === 'vimeo') frame.src = entry.video.src + (autoplay ? '?autoplay=1' : '');
  frame.title = entry.title;
  frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups');
  return frame;
}

function updateCaption(entry) {
  captionDate.textContent = formatDate(entry.date);
  captionTitle.textContent = entry.title;
  captionPos.textContent = entries.length > 1 ? `${currentIndex + 1} of ${entries.length}` : '';
  galleryPos.textContent = entries.length ? `${currentIndex + 1} / ${entries.length}` : '';
  gallery.querySelectorAll('.gallery-item').forEach((card, i) => {
    if (i === currentIndex) card.setAttribute('aria-current', 'true');
    else card.removeAttribute('aria-current');
  });
}

// Travel to entry number `index`
async function travelTo(index) {
  if (!entries.length) return;
  index = (index + entries.length) % entries.length;
  const entry = entries[index];
  const token = ++travelToken;
  const timing = MOTION[settings.motion];

  // Let go of the old title while the next scene gets ready
  caption.classList.add('is-changing');
  const slow = setTimeout(() => showStatus('🔄 Loading space photo…'), 350);

  let built;
  try {
    built = await buildScene(entry, token);
  } catch (error) {
    built = { inner: brokenScene(entry), camera: null };
  }
  clearTimeout(slow);
  if (!built || token !== travelToken) return; // the user already moved on
  showStatus('');

  currentIndex = index;
  const outgoing = layers[activeLayer];
  activeLayer = 1 - activeLayer;
  const incoming = layers[activeLayer];

  // Pause anything still playing in the old scene
  outgoing.querySelectorAll('video').forEach((video) => video.pause());

  incoming.textContent = '';
  incoming.appendChild(built.inner);
  incoming.camera = built.camera;
  incoming.dataset.type = entry.type;
  if (incoming.camera) {
    fitCamera(incoming.camera);
    // Start slightly closer, then drift out to the resting view
    const start = settings.motion === 'off' || settings.mode === 'explore' ? 1 : 1.04;
    incoming.camera.s = incoming.camera.ts * start;
    renderCamera(incoming);
  }

  body.style.setProperty('--t-out', `${timing.out}ms`);
  body.style.setProperty('--t-in', `${timing.in}ms`);
  if (timing.out) stars.burst(settings.motion === 'cinematic' ? 0.9 : 0.5);

  outgoing.classList.remove('is-active');
  outgoing.classList.add('is-leaving');
  incoming.classList.remove('is-leaving');
  // Force the browser to notice the starting state before animating in
  void incoming.offsetWidth;
  incoming.classList.add('is-active');
  moveCamera();

  updateCaption(entry);
  setTimeout(() => {
    if (token === travelToken) caption.classList.remove('is-changing');
  }, settings.motion === 'off' ? 0 : Math.min(500, timing.out));

  // Clean up the old scene after it fades out
  setTimeout(() => {
    if (!outgoing.classList.contains('is-active')) {
      outgoing.classList.remove('is-leaving');
      outgoing.textContent = '';
      outgoing.camera = null;
    }
  }, timing.out + timing.in + 100);

  stars.wake();
  preload(entries[(index + 1) % entries.length]);
  preload(entries[(index - 1 + entries.length) % entries.length]);
}

function brokenScene(entry) {
  const inner = document.createElement('div');
  inner.className = 'scene-inner';
  const box = document.createElement('div');
  box.className = 'scene-video scene-broken';
  const note = document.createElement('p');
  note.textContent = 'This picture could not be loaded.';
  const link = document.createElement('a');
  link.className = 'play-button';
  link.href = entry.permalink;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'View it on NASA\'s site ↗';
  box.append(note, link);
  inner.appendChild(box);
  return inner;
}

function step(direction) {
  if (entries.length > 1) travelTo(currentIndex + direction);
}

// =====================================================================
// 14. Gallery
// =====================================================================
function showGalleryMessage(text) {
  gallery.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'placeholder';
  box.setAttribute('role', 'status');
  const p = document.createElement('p');
  p.textContent = text;
  box.appendChild(p);
  gallery.appendChild(box);
}

function cardImage(entry) {
  if (entry.image) return sizedUrl(entry.image, 480);
  return 'img/NASA-Logo-Large.jpg';
}

function renderGallery(items) {
  gallery.innerHTML = '';
  if (!items.length) {
    showGalleryMessage('No space photos were found for those dates.');
    return;
  }

  items.forEach((entry, index) => {
    const isVideo = entry.type === 'video' || entry.type === 'embed' || (entry.video && entry.type !== 'image');

    // Each card is a button so it works with a keyboard as well as a mouse
    const card = document.createElement('button');
    card.className = 'gallery-item';
    card.type = 'button';
    card.setAttribute('aria-label', `${entry.title}, ${formatDate(entry.date)}${isVideo ? ', video' : ''}. Open details`);

    const wrap = document.createElement('div');
    wrap.className = 'image-wrap';
    const img = document.createElement('img');
    img.src = cardImage(entry);
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      if (entry.image && img.src !== entry.image) img.src = entry.image;
    }, { once: true });
    wrap.appendChild(img);
    if (isVideo) {
      const badge = document.createElement('span');
      badge.className = 'video-badge';
      badge.textContent = '▶ Video';
      wrap.appendChild(badge);
    }

    const title = document.createElement('h3');
    title.className = 'item-title';
    title.textContent = entry.title;
    const date = document.createElement('p');
    date.className = 'item-date';
    date.textContent = formatDate(entry.date);

    card.append(wrap, title, date);
    card.addEventListener('click', () => {
      closePanels(false);
      if (index !== currentIndex) travelTo(index);
      openModal(entry, card);
    });
    gallery.appendChild(card);
  });
}

// =====================================================================
// 15. Loading collections
// =====================================================================
// `loader` is a function that returns a promise of entries
async function loadCollection(loader, label, { openGallery = false } = {}) {
  if (searchController) searchController.abort(); // cancel a slower, older search
  const controller = new AbortController();
  searchController = controller;

  // Show the loading message before the request starts
  showGalleryMessage('🔄 Loading space photos…');
  showStatus('🔄 Loading space photos…');
  getButton.disabled = true;
  dateMessage.textContent = '';

  const panelAtStart = openPanelId;

  try {
    const items = await loader(controller.signal);
    if (controller !== searchController) return;
    entries = items;
    currentIndex = -1;
    galleryRange.textContent = label;
    renderGallery(items);
    showStatus(items.length ? '' : 'No space photos were found for those dates.');
    // Show the new gallery, unless the user has since opened something else
    if (openGallery && items.length && openPanelId === panelAtStart) openPanel('galleryPanel');
    if (items.length) await travelTo(0);
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('APOD request failed:', error);
    const message = `🚫 Couldn't load space photos. ${error.message}`;
    showGalleryMessage(message);
    showStatus(message, () => loadCollection(loader, label, { openGallery }));
    dateMessage.textContent = error.message;
  } finally {
    if (controller === searchController) {
      getButton.disabled = false;
      searchController = null;
    }
  }
}

function rangeLabel(startDate, endDate) {
  return startDate === endDate ? formatDate(startDate) : `${formatDate(startDate)} to ${formatDate(endDate)}`;
}

function getSpaceImages(event, options = {}) {
  if (event) event.preventDefault();
  const { startDate, endDate } = getDateRange();
  const problem = checkRange(startDate, endDate);
  if (problem) {
    dateMessage.textContent = `⚠️ ${problem}`;
    return;
  }
  // Show the dates we actually asked for
  startInput.value = startDate;
  endInput.value = endDate;
  loadCollection((signal) => fetchRange(startDate, endDate, signal), rangeLabel(startDate, endDate), { openGallery: options.openGallery !== false });
}

dateForm.addEventListener('submit', getSpaceImages);

// Move the whole range earlier or later by its own length
function shiftRange(direction) {
  const { startDate, endDate } = getDateRange();
  const length = daysBetween(startDate, endDate) + 1;
  let newStart = addDays(startDate, direction * length);
  let newEnd = addDays(endDate, direction * length);
  if (newEnd > nasaToday()) {
    newEnd = nasaToday();
    newStart = addDays(newEnd, -(length - 1));
  }
  if (newStart < FIRST_APOD) {
    newStart = FIRST_APOD;
    newEnd = addDays(newStart, length - 1);
  }
  startInput.value = newStart;
  endInput.value = newEnd;
  getSpaceImages(null);
}
$('dayEarlier').addEventListener('click', () => shiftRange(-1));
$('dayLater').addEventListener('click', () => shiftRange(1));

$('randomOne').addEventListener('click', () => {
  closePanels();
  loadCollection((signal) => fetchRandom(1, signal), 'A random day from the archive');
});
$('randomSet').addEventListener('click', () => {
  loadCollection((signal) => fetchRandom(6, signal), 'Six random days from the archive', { openGallery: true });
});
$('latestSet').addEventListener('click', () => {
  const end = nasaToday();
  startInput.value = addDays(end, -8);
  endInput.value = end;
  closePanels();
  getSpaceImages(null, { openGallery: false });
});

// =====================================================================
// 16. Modal (details view)
// =====================================================================
function link(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = text;
  return a;
}

function openModal(entry = entries[currentIndex], opener) {
  if (!entry) return;
  modalTitle.textContent = entry.title;
  modalDate.textContent = formatDate(entry.date);
  modalExplanation.textContent = '';
  modalExplanation.appendChild(safeHtml(entry.explanation || '<p>No explanation was provided for this entry.</p>'));

  // Credit and copyright are often the same text, so show it once
  modalCredit.textContent = '';
  const creditText = htmlToText(entry.credit);
  const copyrightText = htmlToText(entry.copyright);
  const addCredit = (html, text, label) => {
    const line = document.createElement('span');
    line.className = 'credit-line';
    if (!/credit|copyright|©/i.test(text.slice(0, 30))) line.append(`${label}: `);
    line.appendChild(safeHtml(html));
    modalCredit.appendChild(line);
  };
  if (creditText) addCredit(entry.credit, creditText, 'Image credit');
  if (copyrightText && copyrightText !== creditText) addCredit(entry.copyright, copyrightText, 'Copyright');

  modalLinks.textContent = '';
  modalLinks.appendChild(link(entry.permalink, 'Original APOD article ↗'));
  if (entry.type === 'image' && entry.image) modalLinks.appendChild(link(entry.image, 'Full-resolution image ↗'));
  if (entry.video && entry.video.link) modalLinks.appendChild(link(entry.video.link, 'Video source ↗'));

  // A larger version of the picture (or the video)
  modalMedia.textContent = '';
  if (entry.type === 'image') {
    const img = document.createElement('img');
    img.src = sizedUrl(entry.image, 1600);
    img.alt = entry.alt;
    img.addEventListener('error', () => {
      if (img.src !== entry.image) img.src = entry.image;
    }, { once: true });
    modalMedia.appendChild(img);
  } else if (entry.type === 'video') {
    const video = document.createElement('video');
    video.src = entry.video.src;
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    if (entry.image) video.poster = sizedUrl(entry.image, 1600);
    modalMedia.appendChild(video);
  } else if (entry.type === 'embed') {
    const frameBox = document.createElement('div');
    frameBox.className = 'video-frame';
    frameBox.appendChild(makeIframe(entry, false));
    modalMedia.appendChild(frameBox);
  } else {
    modalMedia.appendChild(link((entry.video && entry.video.link) || entry.permalink, 'View this entry on its original site ↗'));
  }

  modal.returnFocus = opener || document.activeElement;
  modal.showModal();
  modal.scrollTop = 0;
}

// Stop any playing video once the modal closes (Esc key, button or backdrop)
modal.addEventListener('close', () => {
  modalMedia.textContent = '';
  const back = modal.returnFocus;
  if (back && document.contains(back) && !back.closest('[hidden]')) back.focus();
  else stage.focus({ preventScroll: true });
});

$('modalClose').addEventListener('click', () => modal.close());

// Clicking the dark area outside the modal box closes it too
modal.addEventListener('click', (event) => {
  if (event.target === modal) modal.close();
});

$('captionInfo').addEventListener('click', (event) => openModal(undefined, event.currentTarget));
$('railInfo').addEventListener('click', (event) => {
  closePanels(false);
  openModal(undefined, event.currentTarget);
});

// =====================================================================
// 17. Side panels
// =====================================================================
const railButtons = [...document.querySelectorAll('.rail-button[data-panel]')];
let openPanelId = null;

function openPanel(id) {
  closePanels(false);
  const panel = $(id);
  const button = railButtons.find((b) => b.dataset.panel === id);
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add('is-open'));
  if (button) button.setAttribute('aria-expanded', 'true');
  openPanelId = id;
  body.classList.add('has-panel');
  const first = panel.querySelector('[aria-current="true"]') || panel.querySelector('input, button:not(.panel-close), a');
  if (first) first.focus({ preventScroll: true });
}

function closePanels(returnFocus = true) {
  if (!openPanelId) return;
  const panel = $(openPanelId);
  const button = railButtons.find((b) => b.dataset.panel === openPanelId);
  panel.classList.remove('is-open');
  panel.hidden = true;
  if (button) {
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus) button.focus({ preventScroll: true });
  }
  openPanelId = null;
  body.classList.remove('has-panel');
}

railButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (openPanelId === button.dataset.panel) closePanels();
    else openPanel(button.dataset.panel);
  });
});
document.querySelectorAll('.panel-close').forEach((button) => button.addEventListener('click', () => closePanels()));
$('galleryPrev').addEventListener('click', () => step(-1));
$('galleryNext').addEventListener('click', () => step(1));
$('prevButton').addEventListener('click', () => step(-1));
$('nextButton').addEventListener('click', () => step(1));

// Clicking the photo closes an open panel without changing photos
stage.addEventListener('click', () => {
  if (openPanelId) closePanels(false);
});

// =====================================================================
// 18. View settings
// =====================================================================
const modeHints = {
  immersive: 'Fills the screen. Some edges may be cropped. Move the cursor to look around.',
  original: 'Shows the whole picture with nothing cropped.',
  explore: 'Scroll or pinch to zoom, drag to move around. Double-click to zoom in.'
};

function applySettings() {
  document.querySelectorAll('input[name="mode"]').forEach((input) => { input.checked = input.value === settings.mode; });
  document.querySelectorAll('input[name="motion"]').forEach((input) => { input.checked = input.value === settings.motion; });
  $('cursorToggle').checked = settings.cursor;
  $('cursorToggle').disabled = settings.motion === 'off';
  $('modeHint').textContent = modeHints[settings.mode];
  body.dataset.mode = settings.mode;
  body.dataset.motion = settings.motion;
  layers.forEach((layer) => {
    if (layer.camera) fitCamera(layer.camera);
  });
  moveCamera();
  stars.wake();
  stars.draw();
}

// Explore mode swaps in a sharper copy of the picture for zooming
function upgradeForExplore() {
  const entry = entries[currentIndex];
  const img = activeScene().querySelector('.scene-img');
  if (!entry || !img || entry.type !== 'image') return;
  const sharper = sizedUrl(entry.image, stageWidth(entry, true));
  if (img.src === sharper) return;
  loadImage([sharper]).then((loaded) => {
    if (entries[currentIndex] === entry && document.contains(img)) img.src = loaded.src;
  }).catch(() => {});
}

function setMode(mode) {
  settings.mode = mode;
  saveSettings();
  applySettings();
  if (mode === 'explore') upgradeForExplore();
}

document.querySelectorAll('input[name="mode"]').forEach((input) => {
  input.addEventListener('change', () => setMode(input.value));
});
document.querySelectorAll('input[name="motion"]').forEach((input) => {
  input.addEventListener('change', () => {
    settings.motion = input.value;
    settings.motionChosen = true;
    saveSettings();
    applySettings();
  });
});
$('cursorToggle').addEventListener('change', (event) => {
  settings.cursor = event.target.checked;
  saveSettings();
  applySettings();
});
$('resetView').addEventListener('click', resetView);

reducedMotionQuery.addEventListener('change', () => {
  if (!settings.motionChosen) {
    settings.motion = reducedMotionQuery.matches ? 'off' : 'subtle';
    applySettings();
  }
});

// =====================================================================
// 19. Fullscreen
// =====================================================================
const fullscreenSupported = Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);

function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

async function enterFullscreen() {
  const root = document.documentElement;
  try {
    if (root.requestFullscreen) await root.requestFullscreen();
    else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
  } catch (error) {
    // Denied or not allowed: keep going in the normal window
  }
}

function toggleFullscreen() {
  if (isFullscreen()) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    enterFullscreen();
  }
}

const fullscreenButton = $('fullscreenToggle');
if (!fullscreenSupported) {
  fullscreenButton.disabled = true;
  fullscreenButton.textContent = 'Fullscreen is not available in this browser';
}
fullscreenButton.addEventListener('click', toggleFullscreen);

function onFullscreenChange() {
  fullscreenButton.textContent = isFullscreen() ? 'Exit fullscreen' : 'Enter fullscreen';
  if (isFullscreen()) toast('Fullscreen on. Press Esc to exit.', 3500);
}
document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);

// =====================================================================
// 20. Small messages, idle controls and keyboard
// =====================================================================
let toastTimer = null;
function toast(text, duration = 9000) {
  factToast.textContent = text;
  factToast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => factToast.classList.remove('is-visible'), duration);
}

// Fade the controls after a few quiet seconds so the photo can breathe
let idleTimer = null;
function wakeControls() {
  body.classList.remove('is-idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const busy = openPanelId || modal.open || app.contains(document.activeElement) && document.activeElement !== stage && document.activeElement !== document.body;
    if (!busy) body.classList.add('is-idle');
  }, 3500);
}
['pointermove', 'pointerdown', 'keydown', 'focusin'].forEach((type) => window.addEventListener(type, wakeControls, { passive: true }));

document.addEventListener('keydown', (event) => {
  if (body.classList.contains('is-intro') || modal.open) return;
  if (event.target.closest('input, textarea, select')) {
    if (event.key === 'Escape') closePanels();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  switch (event.key) {
    case 'ArrowRight':
      step(1);
      break;
    case 'ArrowLeft':
      step(-1);
      break;
    case 'i':
    case 'I':
      openModal();
      break;
    case 'g':
    case 'G':
      if (openPanelId === 'galleryPanel') closePanels();
      else openPanel('galleryPanel');
      break;
    case 'd':
    case 'D':
      openPanel('datePanel');
      break;
    case '1':
      setMode('immersive');
      break;
    case '2':
      setMode('original');
      break;
    case '3':
      setMode('explore');
      break;
    case '0':
      resetView();
      break;
    case '+':
    case '=':
      if (settings.mode === 'explore') zoomAt(1.25, window.innerWidth / 2, window.innerHeight / 2);
      break;
    case '-':
      if (settings.mode === 'explore') zoomAt(0.8, window.innerWidth / 2, window.innerHeight / 2);
      break;
    case 'f':
    case 'F':
      if (fullscreenSupported) toggleFullscreen();
      break;
    case 'Escape':
      closePanels();
      break;
    default:
      return;
  }
  event.preventDefault();
});

// =====================================================================
// 21. Entering the experience
// =====================================================================
function enterApp() {
  app.hidden = false;
  body.classList.add('is-entering');
  body.classList.remove('is-intro');
  const fade = settings.motion === 'off' ? 0 : 900;
  stars.burst(settings.motion === 'off' ? 0 : 0.6);
  setTimeout(() => {
    intro.hidden = true;
    body.classList.remove('is-entering');
  }, fade);
  stage.focus({ preventScroll: true });
  wakeControls();
  setTimeout(() => toast(`Did you know? ${randomFact}`), fade + 1800);
}

$('beginButton').addEventListener('click', async () => {
  if (fullscreenSupported) enterFullscreen(); // must happen right after the click
  enterApp();
});

$('beginPlain').addEventListener('click', () => {
  settings.motion = 'off';
  settings.motionChosen = true;
  saveSettings();
  applySettings();
  enterApp();
});

// Start loading the newest pictures right away, while the intro is showing
applySettings();
getSpaceImages(null, { openGallery: false });
