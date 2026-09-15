import { Router } from 'express';

const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';

function isValidLatLng(point) {
  return (
    point &&
    typeof point.lat === 'number' &&
    typeof point.lng === 'number' &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

export const routeRouter = Router();

routeRouter.post('/calculate', async (req, res) => {
  const { origin, destination } = req.body ?? {};

  if (!isValidLatLng(origin)) {
    return res.status(400).json({ message: 'A valid pickup location is required.' });
  }
  if (!isValidLatLng(destination)) {
    return res.status(400).json({ message: 'A valid drop location is required.' });
  }
  if (origin.lat === destination.lat && origin.lng === destination.lng) {
    return res.status(400).json({ message: 'Pickup and drop locations cannot be the same.' });
  }

  const url =
    `${OSRM_URL}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
    '?overview=full&geometries=geojson';

  try {
    const osrmRes = await fetch(url, { headers: { Accept: 'application/json' } });
    const body = await osrmRes.json().catch(() => null);

    if (!osrmRes.ok || !body) {
      console.error('OSRM error:', osrmRes.status, body?.message ?? '(no message)');
      return res.status(502).json({ message: 'Unable to calculate the route right now. Please try again.' });
    }

    if (body.code !== 'Ok') {
      if (body.code === 'NoRoute' || body.code === 'NoSegment') {
        return res.status(404).json({ message: 'No driving route could be found between these locations.' });
      }
      console.error('OSRM returned non-Ok code:', body.code, body.message);
      return res.status(502).json({ message: 'Unable to calculate the route right now. Please try again.' });
    }

    const route = body.routes?.[0];
    if (!route || typeof route.distance !== 'number' || typeof route.duration !== 'number') {
      return res.status(404).json({ message: 'No driving route could be found between these locations.' });
    }

    const distanceMeters = route.distance;
    const durationSeconds = route.duration;
    const coordinates = route.geometry?.coordinates;
    const path = Array.isArray(coordinates)
      ? coordinates.map(([lng, lat]) => ({ lat, lng }))
      : null;

    return res.status(200).json({
      distanceMeters,
      distanceKm: Math.round((distanceMeters / 1000) * 10) / 10,
      durationSeconds,
      durationMinutes: Math.round(durationSeconds / 60),
      path,
    });
  } catch (err) {
    console.error('Route calculation failed:', err.message);
    return res.status(502).json({ message: 'Unable to calculate the route right now. Please try again.' });
  }
});
