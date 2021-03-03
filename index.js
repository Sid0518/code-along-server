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

const queue = [];
io.on("connection", (socket) => {
  console.log(socket.id, "Made new connection");

  socket.on("disconnect", (data) => {
    console.log(socket.id, "has disconnected");
  });

  if (queue.length === 0) {
    queue.push(socket);
  } else {
    const roomId = uuid();
    console.log("Created room", roomId);

    const users = [socket, queue.shift()];
    users.forEach((user) => {
      user.join(roomId);
      console.log("User", user.id, "was added to", roomId);

      user.on("draw", (data) => {
        console.log("Received data for draw from", user.id);

        const rooms = user.rooms.values();
        for (const roomId of rooms) {
          user.to(roomId).emit("draw", data);
        }
      });

      user.on("changedCode", (data) => {
        console.log("Received data for changedCode from", user.id);

        const rooms = user.rooms.values();
        for (const roomId of rooms) {
          user.to(roomId).emit("changedCode", data);
        }
      });
    });
  }
});

