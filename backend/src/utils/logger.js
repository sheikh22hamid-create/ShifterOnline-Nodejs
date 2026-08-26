function timestamp() {
  return new Date().toISOString();
}

function info(...args) {
  console.log(`[${timestamp()}] [INFO]`, ...args);
}

function warn(...args) {
  console.warn(`[${timestamp()}] [WARN]`, ...args);
}

function error(...args) {
  console.error(`[${timestamp()}] [ERROR]`, ...args);
}

module.exports = { info, warn, error };
