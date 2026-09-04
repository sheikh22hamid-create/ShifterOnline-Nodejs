const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "..", "logs");

let currentDate = null;
let currentStream = null;

function dateKey(d) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Lazily (re)opens today's log file, rotating to a new one when the date
// rolls over. Failures here (e.g. read-only disk) must never take the
// process down — dispatch/order handling has to keep running with
// console-only logging rather than crash on a logging problem.
function getStream() {
  const today = dateKey(new Date());
  if (currentStream && currentDate === today) return currentStream;

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    if (currentStream) currentStream.end();
    currentStream = fs.createWriteStream(path.join(LOG_DIR, `app-${today}.log`), { flags: "a" });
    currentStream.on("error", () => {
      currentStream = null;
    });
    currentDate = today;
    return currentStream;
  } catch {
    currentStream = null;
    return null;
  }
}

function formatArgs(args) {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.stack || a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

function timestamp() {
  return new Date().toISOString();
}

function writeToFile(line) {
  const stream = getStream();
  if (stream) stream.write(line + "\n");
}

function info(...args) {
  const line = `[${timestamp()}] [INFO] ${formatArgs(args)}`;
  console.log(`[${timestamp()}] [INFO]`, ...args);
  writeToFile(line);
}

function warn(...args) {
  const line = `[${timestamp()}] [WARN] ${formatArgs(args)}`;
  console.warn(`[${timestamp()}] [WARN]`, ...args);
  writeToFile(line);
}

function error(...args) {
  const line = `[${timestamp()}] [ERROR] ${formatArgs(args)}`;
  console.error(`[${timestamp()}] [ERROR]`, ...args);
  writeToFile(line);
}

module.exports = { info, warn, error };
