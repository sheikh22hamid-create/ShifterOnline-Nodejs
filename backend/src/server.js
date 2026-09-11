require("dotenv").config();

const logger = require("./utils/logger");

// Without these, a startup crash on a host like Render shows only
// "Application exited early" with no indication of why — log the real
// error before the process dies.
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception — process exiting:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection — process exiting:", reason);
  process.exit(1);
});

const http = require("http");
const app = require("./app");
const { initSocket } = require("./sockets/socketServer");
const dispatchManager = require("./services/dispatchManager");
const tripLifecycle = require("./services/tripLifecycle");
const { PICKUP_TIMEOUT_SWEEP_INTERVAL_MS } = require("./config/constants");

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);
initSocket(server);

const { initWhatsAppBot } = require("./whatsapp/client");

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} (REST + Socket.io)`);
  // Initialize WhatsApp Bot Client
  if (process.env.DISABLE_WHATSAPP_BOT !== "true") {
    initWhatsAppBot().catch((err) => logger.error("WhatsApp Bot startup error:", err));
  }
});

// Best-effort cleanup of whatever a previous crash/restart left behind.
// Never blocks startup — listen() above already happened.
dispatchManager.reconcileStaleOffersOnStartup();

// Customer no-show auto-cancel — see tripLifecycle.sweepOverduePickups doc
// comment for why this is a periodic DB-anchored sweep rather than a
// per-order in-memory timer armed at "arrived".
setInterval(() => {
  tripLifecycle.sweepOverduePickups().catch((err) =>
    logger.error("sweepOverduePickups interval failed:", err)
  );
}, PICKUP_TIMEOUT_SWEEP_INTERVAL_MS);
// WhatsApp session reset trigger
