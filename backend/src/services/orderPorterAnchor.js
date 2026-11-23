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
 * Anchor for an order's changed route (porterQuoteService.anchorForNewRoute), or null.
 * null for an unanchored order (callers skip the extra pricing argument and the porter_quote write)
 * AND when no anchor can be computed for the new route: fail closed, the new route is priced on the
 * rate card and the stored anchor is cleared (porterQuoteUpdate), never kept at the old route's fare.
 * route = { pickup:{lat,lng}, drop:{lat,lng}, stops:[{lat,lng}], newDistanceKm }
 */
async function newRouteAnchor(order, route) {
  if (!anchorOf(order)) return null;
  try {
    const { pickup, drop, stops = [], newDistanceKm } = route || {};
    const point = (p) => ({ lat: Number(p?.lat), lng: Number(p?.lng) });
    return (await require("./porterQuoteService").anchorForNewRoute(order, {
      pickup: point(pickup),
      drop: point(drop),
      stops: (Array.isArray(stops) ? stops : []).map(point),
      newDistanceKm: Number(newDistanceKm),
    })) || null;
  } catch (_) {
    return null;
  }
}

/** Extra priceForPackageId args for an anchor: [] when null, so unanchored calls stay byte-identical. */
const anchorArgs = (anchor) => (anchor ? [null, null, anchor] : []);

/**
 * pkg_order.update fields for a route change: {} for an order that had no anchor (column untouched),
 * { porter_quote: newAnchor } when re-anchored, { porter_quote: Prisma.DbNull } when the anchored order
 * lost its anchor. porter_quote is Json?, where Prisma rejects a plain null.
 */
function porterQuoteUpdate(order, newAnchor) {
  if (!anchorOf(order)) return {};
  if (newAnchor) return { porter_quote: newAnchor };
  return { porter_quote: require("@prisma/client").Prisma.DbNull };
}

module.exports = { anchorOf, newRouteAnchor, anchorArgs, porterQuoteUpdate };
