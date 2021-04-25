const express = require("express");
const router = express.Router();

router.post("/", (req, res) => {
  //     if (!req.body.file || !req.body.roomId) {
  //       return res.status(400).send("Doesn't Receive File name or RoomID");
  //   //   }
  //   console.log("In download.js");
  //   console.log(req.body);

  const file = req.body.file;
  const filePath = __dirname + `/files/${req.body.roomId}/` + file;

  res.download(filePath);
});

module.exports = router;
