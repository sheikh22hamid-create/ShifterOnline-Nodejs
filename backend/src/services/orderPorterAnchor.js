/**
 * The Porter anchor stored on an order at creation (pkg_order.porter_quote), or null.
 * porterQuoteService is required lazily (it pulls in outsideDriverService, which can require
 * dispatch/pricing modules back) and any failure degrades to "no anchor" = rate card.
 */
function anchorOf(order) {
  try {
    if (!order || order.porter_quote === undefined || order.porter_quote === null) return null;
    return require("./porterQuoteService").anchorFromOrder(order) || null;
  } catch (_) {
    return null;
  }
}

/**
 * Anchor for an order's changed route (porterQuoteService.anchorForNewRoute): null for an unanchored
 * order, so callers can skip the extra pricing argument and the porter_quote write. Any failure keeps
 * the order's current anchor rather than dropping it to the rate card.
 * route = { pickup:{lat,lng}, drop:{lat,lng}, stops:[{lat,lng}], newDistanceKm }
 */
async function newRouteAnchor(order, route) {
  const current = anchorOf(order);
  if (!current) return null;
  try {
    const { pickup, drop, stops = [], newDistanceKm } = route || {};
    const point = (p) => ({ lat: Number(p?.lat), lng: Number(p?.lng) });
    return (await require("./porterQuoteService").anchorForNewRoute(order, {
      pickup: point(pickup),
      drop: point(drop),
      stops: (Array.isArray(stops) ? stops : []).map(point),
      newDistanceKm: Number(newDistanceKm),
    })) || current;
  } catch (_) {
    return current;
  }
}

/** Extra priceForPackageId args for an anchor: [] when null, so unanchored calls stay byte-identical. */
const anchorArgs = (anchor) => (anchor ? [null, null, anchor] : []);

module.exports = { anchorOf, newRouteAnchor, anchorArgs };
