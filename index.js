const express = require("express");
const socket = require("socket.io");
const { v4: uuid } = require("uuid");

const app = express();
app.get("/", (req, res) => res.send("Hello World!"));

const port = 4000;
const server = app.listen(port, () => {
  console.log(`Listening to port ${port}`);
});

app.use(express.static("public"));

const io = socket(server, {
  cors: {
    origin: "*",
    credentials: true,
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log(socket.id, "Made new connection");

  const roomId = socket.handshake.query.roomId;
  console.log(`Room ID retrieved from ${socket.id}: ${roomId}`);
  socket.join(roomId);

  socket.on("disconnect", (data) => {
    console.log(socket.id, "has disconnected");
    socket.leave(roomId);
  });

  socket.on("draw", (data) => {
    const rooms = socket.rooms.values();
    for (const room of rooms)
      socket.to(room).emit("draw", data);
  });

  socket.on("changedCode", (data) => {
    const rooms = socket.rooms.values();
    for (const room of rooms)
      socket.to(room).emit("changedCode", data);
  });
});
