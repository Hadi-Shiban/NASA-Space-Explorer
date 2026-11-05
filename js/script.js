// NASA Space Explorer: fetches Astronomy Picture of the Day (APOD) entries
// for the chosen dates and shows them in a gallery with a pop-up (modal) view.

// Your free key from https://api.nasa.gov (DEMO_KEY works but is rate limited)
const API_KEY = 'DEMO_KEY';
const APOD_URL = 'https://api.nasa.gov/planetary/apod';

// Find our date picker inputs on the page
const startInput = document.getElementById('startDate');
const endInput = document.getElementById('endDate');

// Call the setupDateInputs function from dateRange.js
// This sets up the date pickers to:
// - Default to a range of 9 days (from 9 days ago to today)
// - Restrict dates to NASA's image archive (starting from 1995)
setupDateInputs(startInput, endInput);

// Other page elements we need
const button = document.getElementById('getImages');
const gallery = document.getElementById('gallery');
const modal = document.getElementById('modal');
const modalMedia = document.getElementById('modalMedia');
const modalTitle = document.getElementById('modalTitle');
const modalDate = document.getElementById('modalDate');
const modalExplanation = document.getElementById('modalExplanation');
const modalCredit = document.getElementById('modalCredit');
const closeButton = document.getElementById('modalClose');

// ---------- LevelUp: random "Did You Know?" space fact ----------
const spaceFacts = [
  'A day on Venus is longer than its year: it spins once every 243 Earth days but orbits the Sun in 225.',
  'Neutron stars are so dense that a teaspoon of one would weigh about a billion tons on Earth.',
  'Light from the Sun takes about 8 minutes and 20 seconds to reach Earth.',
  'The footprints left on the Moon by Apollo astronauts could last millions of years because there is no wind.',
  'Jupiter\'s Great Red Spot is a storm wider than Earth that has raged for at least 350 years.',
  'The Milky Way and the Andromeda galaxy are on course to merge in roughly 4.5 billion years.',
  'Saturn is less dense than water. In a big enough bathtub, it would float.',
  'The International Space Station orbits Earth about 16 times a day.',
  'Olympus Mons on Mars is about 2.5 times taller than Mount Everest.',
  'There are more stars in the observable universe than grains of sand on all of Earth\'s beaches.'
];

// Pick one fact at random each time the page loads
const randomFact = spaceFacts[Math.floor(Math.random() * spaceFacts.length)];
document.getElementById('factText').textContent = randomFact;

// ---------- Dates ----------
// NASA publishes on US Eastern time. In the evening (US time) the browser's
// "today" in UTC can already be tomorrow, and the API rejects future dates.
// So we never ask for a date later than today's date in New York.
function nasaToday() {
  // 'en-CA' formats dates as YYYY-MM-DD, the format the API wants
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Add (or subtract) days from a YYYY-MM-DD date string
function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

// Number of days between two YYYY-MM-DD dates
function daysBetween(start, end) {
  return Math.round((new Date(`${end}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000);
}

// If the end date is past NASA's "today", slide the whole range back
// so we still get the same number of days (9 by default).
function getDateRange() {
  let startDate = startInput.value;
  let endDate = endInput.value;
  const latest = nasaToday();

  if (endDate > latest) {
    const shift = daysBetween(latest, endDate);
    endDate = latest;
    startDate = addDays(startDate, -shift);
  }
  return { startDate, endDate };
}

// ---------- Fetching data ----------
async function getSpaceImages() {
  const { startDate, endDate } = getDateRange();

  if (!startDate || !endDate || startDate > endDate) {
    showMessage('⚠️ Please choose a start date that is before the end date.');
    return;
  }

  // Show the loading message before the request starts
  showMessage('🔄 Loading space photos…');
  button.disabled = true;

  // thumbs=true asks NASA for a preview image when an entry is a video
  const url = `${APOD_URL}?api_key=${API_KEY}&start_date=${startDate}&end_date=${endDate}&thumbs=true`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    // The API sends an error message (not a list) if something went wrong
    if (!response.ok) {
      const reason = data.msg || (data.error && data.error.message) || response.statusText;
      throw new Error(reason);
    }

    // Show the newest picture first
    const entries = data.reverse();
    renderGallery(entries);

    // If NASA's service is having problems it sends the same placeholder
    // ("NASA Science" + logo) for every day. Tell the user instead of hiding it.
    if (isPlaceholderData(entries)) {
      const notice = document.createElement('p');
      notice.className = 'api-notice';
      notice.setAttribute('role', 'status');
      notice.textContent = '⚠️ NASA\'s APOD service is returning placeholder entries right now, so real photos can\'t be shown. Please try again later.';
      gallery.prepend(notice);
    }
  } catch (error) {
    console.error('APOD request failed:', error);
    showMessage(`🚫 Couldn't load space photos: ${error.message}. Please try again in a moment.`);
  } finally {
    button.disabled = false;
  }
}

// ---------- Showing the gallery ----------
// Replace the gallery with a single message (used for loading and errors)
function showMessage(text) {
  gallery.innerHTML = `
    <div class="placeholder" role="status">
      <p>${text}</p>
    </div>
  `;
}

// Pick the picture to show on a card. Videos use their thumbnail.
function getPreviewImage(entry) {
  if (entry.media_type === 'image') {
    return entry.url;
  }
  if (entry.thumbnail_url) {
    return entry.thumbnail_url;
  }
  // No preview available: use the NASA logo instead
  return 'img/NASA-Logo-Large.jpg';
}

function renderGallery(entries) {
  // Clear out the loading message
  gallery.innerHTML = '';

  if (entries.length === 0) {
    showMessage('No space photos were found for those dates.');
    return;
  }

  entries.forEach((entry) => {
    const isVideo = entry.media_type === 'video';

    // Each card is a button so it works with a keyboard as well as a mouse
    const card = document.createElement('button');
    card.className = 'gallery-item';
    card.type = 'button';
    card.setAttribute('aria-label', `Open details for ${entry.title}`);

    card.innerHTML = `
      <div class="image-wrap">
        <img src="${getPreviewImage(entry)}" alt="${escapeText(entry.title)}" loading="lazy" />
        ${isVideo ? '<span class="video-badge">▶ Video</span>' : ''}
      </div>
      <h2 class="item-title">${escapeText(entry.title)}</h2>
      <p class="item-date">${formatDate(entry.date)}</p>
    `;

    card.addEventListener('click', () => openModal(entry));
    gallery.appendChild(card);
  });
}

// ---------- Modal ----------
function openModal(entry) {
  modalTitle.textContent = entry.title;
  modalDate.textContent = formatDate(entry.date);
  modalExplanation.textContent = entry.explanation;
  modalCredit.textContent = entry.copyright ? `Image credit: ${entry.copyright.trim()}` : '';

  if (entry.media_type === 'image') {
    // hdurl is the full-size image when NASA provides one
    const bigImage = entry.hdurl || entry.url;
    modalMedia.innerHTML = `<img src="${bigImage}" alt="${escapeText(entry.title)}" />`;
  } else if (entry.media_type === 'video' && isEmbeddable(entry.url)) {
    // YouTube and Vimeo videos can play right inside the modal
    modalMedia.innerHTML = `
      <div class="video-frame">
        <iframe src="${entry.url}" title="${escapeText(entry.title)}" allowfullscreen></iframe>
      </div>
      <a class="video-link" href="${entry.url}" target="_blank" rel="noopener">Open video in a new tab ↗</a>
    `;
  } else {
    // Any other kind of entry: give a clear link instead
    modalMedia.innerHTML = `
      <a class="video-link" href="${entry.url || 'https://apod.nasa.gov/apod/'}" target="_blank" rel="noopener">
        View this entry on NASA's site ↗
      </a>
    `;
  }

  modal.showModal();
}

function closeModal() {
  modal.close();
}

// Stop any playing video once the modal closes (Esc key, button or backdrop)
modal.addEventListener('close', () => {
  modalMedia.innerHTML = '';
});

closeButton.addEventListener('click', closeModal);

// Clicking the dark area outside the modal box closes it too
modal.addEventListener('click', (event) => {
  if (event.target === modal) {
    closeModal();
  }
});

// ---------- Small helpers ----------
// True when every entry is NASA's generic stand-in instead of a real picture
function isPlaceholderData(entries) {
  return entries.length > 0 && entries.every((entry) => entry.title === 'NASA Science');
}

function isEmbeddable(url) {
  return /youtube\.com|youtu\.be|vimeo\.com/.test(url || '');
}

// Turn "2026-10-30" into "October 30, 2026"
function formatDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Make sure titles with quotes or < > characters can't break our HTML
function escapeText(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML.replace(/"/g, '&quot;');
}

// Fetch new images when the button is clicked
button.addEventListener('click', getSpaceImages);
