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

/**
 * Route-relevant state of a pkg_order row (+ caller extras, e.g. the stop list) as one comparable string.
 * Used to tell whether the row read before a row-lock transaction still matches the locked row.
 */
function routeBasis(order, extra = null) {
  if (!order) return null;
  const q = order.porter_quote;
  const dist = order.distance === null || order.distance === undefined ? null : String(order.distance);
  return JSON.stringify([
    order.plat, order.plong, order.dlat, order.dlong, dist,
    order.extra_mile_charge === null || order.extra_mile_charge === undefined ? null : String(order.extra_mile_charge),
    q === null || q === undefined ? null : typeof q === "string" ? q : JSON.stringify(q),
    extra,
  ]);
}

/**
 * Re-anchor work that may call Porter (up to its timeout), done BEFORE a row-lock transaction opens so the
 * network call never holds the lock or eats Prisma's 5 s transaction timeout.
 * order: the row read outside the transaction. computeRoute(order) -> { pickup, drop, stops, newDistanceKm, ... }.
 * Returns null for an unanchored order (nothing to do) or on any error (the locked step then fails closed),
 * else { basis, route, anchor } where anchor may be null (no anchor for the new route).
 */
async function precomputeNewRouteAnchor(order, computeRoute, extra = null) {
  if (!anchorOf(order)) return null;
  try {
    const route = await computeRoute(order);
    if (!route) return null;
    const anchor = await newRouteAnchor(order, route);
    return { basis: routeBasis(order, extra), route, anchor };
  } catch (_) {
    return null;
  }
}

/**
 * Inside the transaction, with the locked row: use the precomputed anchor + route only if the row's route and
 * anchor are unchanged since the pre-read. matched:false for an anchored row that changed meanwhile (or had no
 * precompute) -> anchor null: the new route is priced on the rate card and the stored anchor cleared (fail closed).
 * An unanchored locked row -> { matched:false, anchor:null, route:null } and callers keep their unanchored path.
 */
function lockedRouteAnchor(pre, lockedOrder, extra = null) {
  if (!anchorOf(lockedOrder) || !pre || pre.basis !== routeBasis(lockedOrder, extra)) {
    return { matched: false, anchor: null, route: null };
  }
  return { matched: true, anchor: pre.anchor || null, route: pre.route };
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

module.exports = { anchorOf, newRouteAnchor, anchorArgs, porterQuoteUpdate, routeBasis, precomputeNewRouteAnchor, lockedRouteAnchor };
