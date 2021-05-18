const express = require("express");
const router = express.Router();
var AdmZip = require("adm-zip");
const fs = require("fs");

router.post("/", (req, res) => {
  const file = req.body.file;
  const filePath = __dirname + `/files/${req.body.roomId}/` + file;

  res.download(filePath);
});

router.post("/all", (req, res) => {
  const folderLocation = __dirname + `/files/${req.body.roomId}`;
  let zip = new AdmZip();
  var uploadDir = fs.readdirSync(folderLocation);

  for (var i = 0; i < uploadDir.length; i++) {
    zip.addLocalFile(`${folderLocation}/` + uploadDir[i]);
  }

  const downloadName = `State of ${req.body.roomId}.zip`;

  const data = zip.toBuffer();
  res.set("Content-Type", "application/octet-stream");
  res.set("Content-Disposition", `attachment; filename=${downloadName}`);
  res.set("Content-Length", data.length);
  res.send(data);
});

module.exports = router;
