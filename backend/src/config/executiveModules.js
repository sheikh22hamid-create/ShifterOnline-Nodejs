/**
 * Executive sidebar access control.
 *
 * A module key is the sidebar route path (frontend/src/config/navigation.js `to`). An executive's allowed
 * modules live in admin.permissions as JSON: {"sidebar_modules": ["/orders", "/drivers"]}.
 *   - permissions empty / unparsable / without sidebar_modules  => unrestricted (every executive that existed
 *     before this feature keeps exactly the access it had).
 *   - sidebar_modules present (even [])                         => the executive may only reach those modules.
 *
 * Executives are already read-only on the API (authorize() whitelists); this layer only narrows what they can READ.
 */

// Every sidebar module an executive can be given. Keep in sync with navigation.js (a test enforces it).
const EXECUTIVE_MODULES = [
  "/dashboard",
  "/fleet/live-tracking",
  "/orders",
  "/orders/scheduled",
  "/orders/next-day",
  "/custom-orders",
  "/customise-orders",
  "/drivers",
  "/favorite-routes",
  "/monthly-drivers",
  "/daily-drivers",
  "/free-booking",
  "/booking-guarantee",
  "/guarantee/my-cases",
  "/order-search",
  "/tiered-dispatch",
  "/driver-performance",
  "/fleet/driver-activity",
  "/trip-feedback",
  "/driver-training",
  "/driver-leads",
  "/registration-leads",
  "/trial-drivers",
  "/user-leads",
  "/kyc",
  "/customers",
  "/service-zones",
  "/rate-cards",
  "/categories",
  "/vehicles",
  "/cities",
  "/marketing/premium-plans",
  "/marketing/coupons",
  "/marketing/banners",
  "/referrals",
  "/cms/faqs",
  "/cms/pages",
  "/cms/cancel-reasons",
  "/cms/goods-types",
  "/cms/restricted-items",
  "/cms/booking-guidelines",
];

const ANY = "*"; // any enabled module is enough (shared lookup data every page needs)

// Pages that list/assign orders and therefore read /orders/* and /riders.
const ORDER_PAGES = [
  "/orders", "/orders/scheduled", "/orders/next-day", "/dashboard", "/fleet/live-tracking",
  "/guarantee/my-cases", "/booking-guarantee", "/monthly-drivers", "/daily-drivers",
];

// API path prefix (relative to /api/v1/admin) -> modules that may read it (any one is enough).
// The page -> endpoint map was built from the admin panel's api.* calls. Longest prefix wins.
// A path matching no rule is denied to a restricted executive (fail closed); /auth is exempted in the middleware.
const API_RULES = [
  ["/upload-image", [ANY]],
  ["/cities", [ANY]],
  ["/vehicles", [ANY]],
  ["/categories", [ANY]],
  ["/service-zones", ["/service-zones", "/daily-drivers", "/monthly-drivers"]],
  ["/no-entry-zones", ["/service-zones"]],
  ["/rate-cards", ["/rate-cards"]],

  ["/fleet/live-tracking", ["/fleet/live-tracking", "/drivers", "/dashboard"]],
  ["/fleet/active-trips", ["/fleet/live-tracking", "/dashboard", "/orders"]],
  ["/fleet/driver-activity", ["/fleet/driver-activity"]],

  ["/orders/scheduled", ["/orders/scheduled"]],
  ["/orders/next-day", ["/orders/next-day", "/daily-drivers"]],
  ["/orders", ORDER_PAGES],
  ["/outside-driver", ORDER_PAGES],

  ["/riders", ["/drivers", "/kyc", "/trial-drivers", ...ORDER_PAGES]],
  ["/trial-drivers", ["/trial-drivers"]],
  ["/training", ["/driver-training", "/drivers"]],
  ["/customers", ["/customers", "/free-booking"]],
  ["/customer-feedback", ["/trip-feedback"]],
  ["/receiver-feedback", ["/trip-feedback"]],
  ["/trip-feedback", ["/trip-feedback"]],
  ["/custom-orders", ["/custom-orders"]],
  ["/customise-orders", ["/customise-orders"]],
  ["/favorite-routes", ["/favorite-routes"]],

  ["/monthly-drivers", ["/monthly-drivers", "/drivers"]],
  ["/daily-driver", ["/daily-drivers"]],
  ["/free-booking", ["/free-booking"]],
  ["/booking-guarantee/exec", ["/guarantee/my-cases", "/booking-guarantee"]],
  ["/booking-guarantee", ["/booking-guarantee", "/orders"]],
  ["/order-search", ["/order-search"]],
  ["/tier-dispatch", ["/tiered-dispatch", "/driver-performance"]],
  ["/driver-performance", ["/driver-performance"]],

  ["/driver-leads", ["/driver-leads"]],
  ["/registration-leads", ["/registration-leads"]],
  ["/user-leads", ["/user-leads"]],

  ["/marketing/premium-plans", ["/marketing/premium-plans"]],
  ["/marketing/coupons", ["/marketing/coupons"]],
  ["/marketing/banners", ["/marketing/banners"]],
  ["/referrals", ["/referrals"]],
  ["/reward-plans", ["/referrals"]],

  ["/faqs", ["/cms/faqs"]],
  ["/pages", ["/cms/pages"]],
  ["/cancel-reasons", ["/cms/cancel-reasons", "/orders"]],
  ["/goods-types", ["/cms/goods-types"]],
  ["/restricted-items", ["/cms/restricted-items"]],
  ["/booking-guidelines", ["/cms/booking-guidelines"]],

  // Global search returns orders/drivers/customers; the controller filters each section by module too.
  ["/search", ["/orders", "/orders/scheduled", "/orders/next-day", "/drivers", "/kyc", "/customers"]],
].sort((a, b) => b[0].length - a[0].length);

// Which modules unlock each section of the global search response.
const SEARCH_SECTIONS = {
  orders: ["/orders", "/orders/scheduled", "/orders/next-day"],
  drivers: ["/drivers", "/kyc"],
  customers: ["/customers"],
};

/** admin.permissions -> string[] of allowed modules, or null when the executive is unrestricted. */
function parseSidebarModules(permissions) {
  if (!permissions) return null;
  let parsed;
  try {
    parsed = typeof permissions === "string" ? JSON.parse(permissions) : permissions;
  } catch (_e) {
    return null;
  }
  if (!parsed || !Array.isArray(parsed.sidebar_modules)) return null;
  return parsed.sidebar_modules.filter((m) => EXECUTIVE_MODULES.includes(m));
}

/** string[] | null -> value to store in admin.permissions (null keeps the account unrestricted). */
function serializeSidebarModules(modules) {
  if (modules === null || modules === undefined) return null;
  return JSON.stringify({ sidebar_modules: modules });
}

/** Validates a client-supplied module list. Returns { ok, modules } or { ok:false, message }. */
function normalizeSidebarModules(input) {
  if (input === null) return { ok: true, modules: null };
  if (!Array.isArray(input)) return { ok: false, message: "sidebar_modules must be an array of module paths or null" };
  const unknown = input.filter((m) => !EXECUTIVE_MODULES.includes(m));
  if (unknown.length) return { ok: false, message: `Unknown sidebar module(s): ${unknown.join(", ")}` };
  return { ok: true, modules: [...new Set(input)] };
}

/** Modules that unlock an API path, or undefined when no rule covers it. */
function modulesForApiPath(apiPath) {
  const p = apiPath.split("?")[0].toLowerCase().replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
  for (const [prefix, modules] of API_RULES) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return modules;
  }
  return undefined;
}

/** True when a restricted executive (allowed = string[]) may call this API path. */
function isApiPathAllowed(apiPath, allowed) {
  const needed = modulesForApiPath(apiPath);
  if (!needed) return false;
  if (needed.includes(ANY)) return allowed.length > 0;
  return needed.some((m) => allowed.includes(m));
}

function canSearchSection(allowed, section) {
  if (!allowed) return true;
  return (SEARCH_SECTIONS[section] || []).some((m) => allowed.includes(m));
}

module.exports = {
  EXECUTIVE_MODULES,
  API_RULES,
  parseSidebarModules,
  serializeSidebarModules,
  normalizeSidebarModules,
  modulesForApiPath,
  isApiPathAllowed,
  canSearchSection,
};
