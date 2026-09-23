// Isolated Android transport fixture. No database or dispatch services.
const http = require('http');
const { Server } = require('socket.io');
const server = http.createServer((req, res) => {
  if (req.url === '/drop') for (const socket of io.sockets.sockets.values()) socket.conn.close();
  res.writeHead(200); res.end('driver-review fixture');
});
const io = new Server(server);
io.on('connection', socket => {
  socket.on('driver:join', () => socket.emit('order:request', { fixture: 'local-review-only' }));
});
server.listen(4317, '127.0.0.1', () => console.log('Local driver socket fixture ready on 4317'));
