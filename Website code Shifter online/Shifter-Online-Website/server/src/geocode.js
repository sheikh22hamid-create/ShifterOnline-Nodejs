import { Router } from 'express';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
// Nominatim's usage policy requires a descriptive User-Agent identifying the
// application, and caps the public instance at ~1 request/second.
// https://operations.osmfoundation.org/policies/nominatim/
const USER_AGENT = 'ShifterOnlineWebsite/1.0 (+https://shifteronline.example)';
const MIN_REQUEST_SPACING_MS = 1100;

let lastRequestAt = 0;
let queue = Promise.resolve();

function throttledFetch(url) {
  queue = queue.then(async () => {
    const wait = MIN_REQUEST_SPACING_MS - (Date.now() - lastRequestAt);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestAt = Date.now();
    return fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  });
  return queue;
}

export const geocodeRouter = Router();

geocodeRouter.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();

  if (q.length < 3) {
    return res.status(400).json({ message: 'Enter at least 3 characters to search.' });
  }
  if (q.length > 200) {
    return res.status(400).json({ message: 'Search text is too long.' });
  }

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('countrycodes', 'in');

  try {
    const nomRes = await throttledFetch(url.toString());

    if (!nomRes.ok) {
      console.error('Nominatim search error:', nomRes.status);
      return res.status(502).json({ message: 'Unable to search locations right now. Please try again.' });
    }

    const results = await nomRes.json();

    const places = (Array.isArray(results) ? results : [])
      .map((r) => ({
        placeId: String(r.place_id),
        address: r.display_name,
        lat: Number(r.lat),
        lng: Number(r.lon),
      }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

    return res.status(200).json({ results: places });
  } catch (err) {
    console.error('Geocode search failed:', err.message);
    return res.status(502).json({ message: 'Unable to search locations right now. Please try again.' });
  }
});
