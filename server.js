require("dotenv").config();
const express = require("express");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");
const fs = require("fs");

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3001;
const API_SECRET = process.env.API_SECRET;

async function convertDocx(sourceFolder, destFolder) {
  // Write credentials from env to a temp file
  const credsPath = __dirname + "/google_creds_temp.json";
  fs.writeFileSync(credsPath, process.env.GOOGLE_CREDENTIALS);

  const auth = await authenticate({
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/drive.file",
    ],
    keyfilePath: credsPath,
  });
  const drive = google.drive({ version: "v3", auth });

  async function getFolderIdByName(name) {
    const res = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`,
      fields: "files(id, name)",
      spaces: "drive",
    });
    if (!res.data.files.length) throw new Error(`Folder '${name}' not found`);
    return res.data.files[0].id;
  }

  const sourceFolderId = await getFolderIdByName(sourceFolder);
  const destFolderId = await getFolderIdByName(destFolder);

  const filesRes = await drive.files.list({
    q: `'${sourceFolderId}' in parents and mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' and trashed=false`,
    fields: "files(id, name)",
  });

  for (const file of filesRes.data.files) {
    const copyRes = await drive.files.copy({
      fileId: file.id,
      requestBody: {
        name: file.name.replace(/\.docx$/, ""),
        parents: [destFolderId],
        mimeType: "application/vnd.google-apps.document",
      },
    });
    console.log(`Converted and copied: ${file.name} -> ${copyRes.data.name}`);
  }
}

app.post("/convert-docx", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== API_SECRET) {
    return res.status(401).send("Unauthorized: Invalid or missing API key");
  }
  const { from, to } = req.body;
  if (!from || !to) {
    return res.status(400).send("Missing 'from' or 'to' in request body");
  }
  try {
    await convertDocx(from, to);
    res.status(200).send("Conversion complete!");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error: " + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
});
