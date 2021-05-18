const express = require("express");
const router = express.Router();

router.post("/", (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send("No files were uploaded.");
  }

  const file = req.files.file;
  const filePath = __dirname + `/files/${req.body.roomId}/` + file.name;

  file.mv(filePath, (err) => {
    if (err) return res.status(500).send(err);
    res.status(200).send("Data Received");
  });
});

module.exports = router;
