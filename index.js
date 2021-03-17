const express = require("express");
const socket = require("socket.io");

const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
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

const roomData = {};
const TIME_DELTA = 2000 // in milliseconds
io.on("connection", (socket) => {
  console.log(socket.id, "Made new connection");

  const roomId = socket.handshake.query.roomId;
  if(!(roomId in roomData))
    roomData[roomId] = {};
  console.log(`Room ID retrieved from ${socket.id}: ${roomId}`);
  socket.join(roomId);

  socket.on("disconnect", (data) => {
    console.log(socket.id, "has disconnected");
    socket.leave(roomId);
  });

  socket.on("membersRequest", (data) => {
    const roomId = data.roomId;
    const members = io.sockets.adapter.rooms.get(roomId);
    socket.emit("membersResponse", {
      members: [...members]
    });
  });

  socket.on("draw", (data) => {
    const rooms = socket.rooms.values();
    for (const room of rooms)
      if (room !== socket.id) socket.to(room).emit("draw", data);
  });

  socket.on("changedCode", (data) => {
    const timestamp = Date.now();

    const rooms = socket.rooms.values();
    for (const room of rooms) {
      if (room !== socket.id) {
        const prevTimestamp = roomData[room].timestamp;
        const prevClient = roomData[room].client;

        //----------------------handle concurrency----------------------//
        if(
          (prevTimestamp === undefined) || 
          (timestamp - prevTimestamp) > TIME_DELTA ||
          (socket.id === prevClient)
        ) {
          roomData[room].timestamp = timestamp;
          roomData[room].client = socket.id;
          roomData[room].changedCodeData = data;
          socket.to(room).emit("changedCode", data);
        }

        else {
          console.log("changedCode event was rejected");
          socket.emit("changedCode", roomData[room].changedCodeData);
        }
        //-------------------------------------------------------------//
      }
    }
  });

  socket.on("executeCode", (data) => {
    const code = data.code;
    const lang = data.lang;

    const rooms = socket.rooms.values();
    for (const room of rooms) {
      if (room !== socket.id) 
        executeCode(code, lang, socket, room);
    }
  });
});

const EXTENSIONS = {
  python: "py",
  javascript: "js",
};

const executeCode = async (code, lang, socket, room) => {
  const codeFile = room;
  const ext = EXTENSIONS[lang];

  // const codeLocation = path.join("received_codes", `${codeFile}.${ext}`);
  const codeLocation = `${codeFile}.${ext}`;
  fs.writeFile(codeLocation, code, (error) => {
    if (error) throw error;
  });

  let command = "";
  switch (lang) {
    case "python":
      command = `python \"${codeLocation}\"`;
      break;
    case "javascript":
      command = `node \"${codeLocation}\"`;
      break;
  }

  exec(command, (error, stdout, stderr) => {
    socket.to(room).emit("codeOutput", {
      error: error,
      stderr: stderr,
      stdout: stdout,
    });

    if (error) console.log(`error: ${error.message}`);
    else if (stderr) console.log(`stderr: ${stderr}`);
    else console.log(`stdout: ${stdout}`);
  });
};
