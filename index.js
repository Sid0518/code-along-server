const express = require("express");
const socket = require("socket.io");

const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

const app = express();
app.get("/", (req, res) => res.send("Hello World!"));

const port = 4000;
const server = app.listen(port, () => {
  console.log(`Listening to port ${port}`);
});

app.use(express.static("public"));

const store = {};

const io = socket(server, {
  cors: {
    origin: "*",
    credentials: true,
    methods: ["GET", "POST"],
  },
});

const roomData = {};
const TIME_DELTA = 2000; // in milliseconds
io.on("connection", (socket) => {
  let memberListEmmited = false;
  console.log(socket.id, "Made new connection");

  const roomId = socket.handshake.query.roomId;
  let userName = socket.handshake.query.userName;
  console.log(
    `Room ID retrieved from ${socket.id}: ${roomId} with an alias of ${userName}`
  );
  socket.join(roomId);

  store[socket.id] = {
    socket,
    userName,
    language: null,
  };

  if (!(roomId in roomData))
    roomData[roomId] = {
      whiteboard: [],
      code: {},
      timestamp: {},
      client: {},
    };

  socket.emit("roomState", {
    whiteboard: roomData[roomId].whiteboard,
    code: roomData[roomId].code,
  });

  if (!memberListEmmited) {
    const members = io.sockets.adapter.rooms.get(roomId);

    let newList = {};
    members.forEach((member) => {
      newList[member] = store[member].userName;
    });

    socket.emit("newMember", { ...newList });
    io.in(roomId).emit("newMember", { ...newList });
    memberListEmmited = true;
  }

  socket.on("messageSend", (data) => {
    socket.emit("newMessage", { ...data, user: store[socket.id].userName });
    io.in(roomId).emit("newMessage", {
      ...data,
      user: store[socket.id].userName,
    });
  });

  socket.on("disconnect", (data) => {
    if (socket.id !== null && socket.id) {
      console.log(socket.id, "has disconnected");
      io.in(roomId).emit("memberLeave", {
        id: socket.id,
        userName: store[socket.id].userName,
      });
      delete store[socket.id];
      socket.leave(roomId);
    }
  });

  socket.on("explicitDisconnect", (data) => {
    if (socket.id !== null && socket.id) {
      console.log(socket.id, "has disconnected");
      io.in(roomId).emit("memberLeave", {
        id: socket.id,
        userName: store[socket.id].userName,
      });
      delete store[socket.id];
      socket.leave(roomId);
    }
  });

  socket.on("draw", (data) => {
    const rooms = socket.rooms.values();
    for (const room of rooms) {
      if (room !== socket.id) {
        roomData[room].whiteboard.push(data);
        socket.to(room).emit("draw", data);
      }
    }
  });

  socket.on("setLanguage", (data) => {
    store[socket.id].language = data.language;
  });

  socket.on("codeRequest", (data) => {
    const rooms = socket.rooms.values();
    for (const room of rooms) {
      if (room !== socket.id) {
        let code = roomData[room].code[data.lang];
        if (code === null || code === undefined) code = "";
        socket.emit("codeResponse", {
          code,
        });
      }
    }
  });

  socket.on("changedCode", (data) => {
    const timestamp = Date.now();

    const rooms = socket.rooms.values();
    for (const room of rooms) {
      if (room !== socket.id) {
        const prevTimestamp = roomData[room].timestamp[data.lang];
        const prevClient = roomData[room].client[data.lang];

        //----------------------handle concurrency----------------------//
        if (
          prevTimestamp === undefined ||
          timestamp - prevTimestamp > TIME_DELTA ||
          socket.id === prevClient
        ) {
          roomData[room].timestamp[data.lang] = timestamp;
          roomData[room].client[data.lang] = socket.id;
          roomData[room].code[data.lang] = data.code;

          socket.to(room).emit("changedCode", {
            userName: store[socket.id].userName,
            ...data,
          });
        } else {
          console.log("changedCode event was rejected");
          socket.emit("changedCode", {
            userName: store[prevClient].userName,
            code: roomData[room].code[data.lang],
            lang: data.lang,
          });
        }
        //-------------------------------------------------------------//
      }
    }
  });

  socket.on("executeCode", (data) => {
    const code = data.code;
    const lang = data.lang;

    const rooms = socket.rooms.values();
    for (const room of rooms)
      if (room !== socket.id) executeCode(code, lang, room);
  });
});

const EXTENSIONS = {
  python: "py",
  javascript: "js",
};

const executeCode = async (code, lang, room) => {
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
    io.sockets.in(room).emit("codeOutput", {
      error: error,
      stderr: stderr,
      stdout: stdout,
    });

    if (error) console.log(`error: ${error.message}`);
    else if (stderr) console.log(`stderr: ${stderr}`);
    else console.log(`stdout: ${stdout}`);
  });
};
