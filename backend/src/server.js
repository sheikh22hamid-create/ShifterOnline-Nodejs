require("dotenv").config();

const http = require("http");
const app = require("./app");
const { initSocket } = require("./sockets/socketServer");
const logger = require("./utils/logger");

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);
initSocket(server);

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} (REST + Socket.io)`);
});
