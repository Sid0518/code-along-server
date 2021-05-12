const express = require("express");
const socket = require("socket.io");
const cors = require("cors");
const fileUpload = require("express-fileupload");

const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

const uploadRouter = require("./upload");
const downloadRouter = require("./download");

const app = express();
app.get("/", (req, res) => res.send("Hello World!"));

const port = 4000;
const server = app.listen(port, () => {
  console.log(`Listening to port ${port}`);
});

//following app.use is to bypass CORS(Cross-Origin-Resource-Sharing) Policy
app.use(
  cors({
    origin: "http://localhost:3000",
  })
);

app.use(express.json());
app.use(fileUpload());
app.use("/upload", uploadRouter);
app.use("/download", downloadRouter);

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
const filesDir = `${__dirname}/files`;
const codesDir = `${__dirname}/codes`;

function initializeRoom(roomId) {
  roomData[roomId] = {
    whiteboard: [],
    code: {},
    timestamp: {},
    client: {},
  };

  const roomFiles = path.join(filesDir, roomId);
  fs.mkdirSync(roomFiles, {recursive: true}, (error) => {
    if (error)
      console.log("Could not create files folder for room " + roomId + " due to the following error: " + error);
  });

  const roomCodes = path.join(codesDir, roomId);
  fs.mkdirSync(roomCodes, {recursive: true}, (error) => {
    if (error)
      console.log("Could not create codes folder for room " + roomId + " due to the following error: " + error);
  });
}

function resetRoomDeletion(roomId) {
  const timeout = roomData[roomId].deletionTimeout;
  if (timeout !== undefined) {
    clearTimeout(timeout);
    delete roomData[roomId].deletionTimeout;
    console.log("Cleared room deletion timeout");
  }
}

io.on("connection", (socket) => {
  console.log(socket.id, "Made new connection");

  const roomId = socket.handshake.query.roomId;
  const userName = socket.handshake.query.userName;
  socket.join(roomId);
  console.log(`${socket.id} joined ${roomId} with a username of ${userName}`);

  store[socket.id] = {
    userName,
    language: null,
  };

  if(roomId in roomData)
    resetRoomDeletion(roomId);
  else
    initializeRoom(roomId);

  socket.emit("roomState", {
    whiteboard: roomData[roomId].whiteboard,
    code: roomData[roomId].code,
  });

  const memberIds = io.sockets.adapter.rooms.get(roomId);
  const members = {};
  memberIds.forEach(id => members[id] = store[id].userName);
  io.in(roomId).emit("newMember", members);

  socket.on("messageSend", (data) => {
    io.in(roomId).emit("newMessage", {
      ...data,
      user: store[socket.id].userName,
    });
  });

  function handleDisconnect(socketData) {
    if (store[socket.id]) {
      console.log(socket.id, "has disconnected");

      io.in(roomId).emit("memberLeave", {
        id: socket.id,
        userName: store[socket.id].userName,
      });
      socket.leave(roomId);
      delete store[socket.id];

      const members = io.sockets.adapter.rooms.get(roomId);
      if (members === undefined) {
        console.log("Room", roomId, "is now empty");

        const DELETION_DURATION = 24*60*60*1000; // 24 hrs
        roomData[roomId].deletionTimeout = setTimeout(() => {
          delete roomData[roomId];

          let folder = path.join(filesDir, roomId);
          deleteFolder(folder);
          folder = path.join(codesDir, roomId);
          deleteFolder(folder);

          console.log("Room", roomId, "was deleted");
        }, DELETION_DURATION);
      }
    }
  }

  socket.on("disconnect", handleDisconnect);
  socket.on("explicitDisconnect", handleDisconnect);

  socket.on("filesList", (data) => {
    const filesList = [];
    const folderLocation = `${filesDir}/${roomId}`;

    if (fs.existsSync(folderLocation))
      fs.readdirSync(folderLocation)
        .forEach(file => filesList.push(file));

    io.in(roomId).emit("newFilesList", filesList);
  });

  socket.on("draw", (data) => {
    const rooms = socket.rooms.values();
    for (const room of rooms) {
      if (room !== socket.id) {
        roomData[room].whiteboard.push(data);

        // BROADCAST emit - Event is NOT sent to the socket itself
        socket.to(room).emit("draw", data);
      }
    }
  });

  socket.on("codeRequest", (data) => {
    const rooms = socket.rooms.values();
    for (const room of rooms) {
      if (room !== socket.id) {
        let code = roomData[room].code[data.lang];
        if (code === null || code === undefined)
          code = "";

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

          // BROADCAST emit - Event is NOT sent to the socket itself
          socket.to(room).emit("changedCode", {
            userName: store[socket.id].userName,
            ...data,
          });
        } 
        
        else {
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
      if (room !== socket.id)
        executeCode(code, lang, room);
  });
});

const EXTENSIONS = {
  "python": "py",
  "javascript": "js",
  "c": "c",
  "cpp": "cpp",
  "java": "java",
};

const executeCode = async (code, lang, room) => {
  const roomFolder = path.join(codesDir, room);
  const ext = EXTENSIONS[lang];

  const codeFile = path.join(roomFolder, `main.${ext}`);
  fs.writeFile(codeFile, code, (error) => {
    if (error) 
      throw error;
  });

  if (["c", "cpp", "java"].includes(lang))
    compileAndExecute(codeFile, lang, room);
  else
    directlyExecute(codeFile, lang, room);
}

const compileAndExecute = (codeFile, lang, room) => {
  const roomFolder = path.join(codesDir, room);

  let compileCommand = "";
  let outFile = path.join(roomFolder, `${Date.now()}.exe`);

  switch (lang) {
    case "c":
      compileCommand = `gcc \"${codeFile}\" -o \"${outFile}\"`;
      break;
    case "cpp":
      compileCommand = `g++ \"${codeFile}\" -o \"${outFile}\"`;
      break;
    case "java":
      compileCommand = `javac \"${codeFile}\" -verbose`;
      break;
  }

  exec(
    compileCommand, 
    (error, stdout, stderr) => {
      if (error) {
        console.log("Compilation error");
        emitCodeOutput(room, error, stdout, stderr);
      }
      
      else {
        let executeCommand = "";
        switch (lang) {
          case "c":
          case "cpp":
            executeCommand = `\"${outFile}\"`;
            break;

          case "java":
            const match = stderr.match(/\[wrote RegularFileObject\[(?:.*\\)*([^\\]*)\.class\]\]/);
            const classFile = match[1];
            executeCommand = `java -cp \"${roomFolder}\"; ${classFile}"`;

            outFile = path.join(roomFolder, `${classFile}.class`);
            break;
        }

        exec(
          executeCommand, 
          (error, stdout, stderr) => {
            emitCodeOutput(room, error, stdout, stderr);
            deleteFile(outFile);
          }
        );
      }
    }
  );
}

const directlyExecute = (codeFile, lang, room) => {
  let command = "";
  switch (lang) {
    case "python":
      command = `python \"${codeFile}\"`;
      break;
    case "javascript":
      command = `node \"${codeFile}\"`;
      break;
  }

  exec(
    command, 
    (error, stdout, stderr) => 
      emitCodeOutput(room, error, stdout, stderr)
  );
}

const emitCodeOutput = (room, error, stdout, stderr) => {
  io.sockets.in(room).emit("codeOutput", {
    error: error,
    stderr: stderr,
    stdout: stdout,
  });

  // if (error) console.log(`error: ${error.message}`);
  // else if (stderr) console.log(`stderr: ${stderr}`);
  // else console.log(`stdout: ${stdout}`);
}

const deleteFolder = (folder) => {
  if (fs.existsSync(folder))
    fs.rmdirSync(folder, {recursive: true}, (error) => {
      if (error)
        console.log(folder + " could not be deleted due to an error - " + error);
    });
}

const deleteFile = (file) => {
  fs.unlink(file, (error) => {
    if (error)
      console.log("Could not delete " + file + " due to following error: " + error);
    }
  );
}