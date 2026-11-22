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

module.exports = { anchorOf };
