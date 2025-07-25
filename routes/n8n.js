import express from "express";
import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const API_SECRET = process.env.API_SECRET;
const DRIVE_ID = process.env.DRIVE_ID;

async function getDriveClient() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/drive.file",
    ],
  });
  return google.drive({ version: "v3", auth });
}

router.post("/list-folder", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== API_SECRET) {
    return res.status(401).send("Unauthorized: Invalid or missing API key");
  }
  const { folderId } = req.body;
  if (!folderId) {
    return res.status(400).send('Missing "folderId" in request body');
  }
  try {
    const drive = await getDriveClient();
    const filesRes = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "files(id, name, mimeType, parents)",
      driveId: DRIVE_ID,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      corpora: "drive",
    });
    const files = filesRes.data.files.map((file) => {
      let url;
      if (file.mimeType === "application/vnd.google-apps.document") {
        url = `https://docs.google.com/document/d/${file.id}/edit`;
      } else if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
        url = `https://docs.google.com/spreadsheets/d/${file.id}/edit`;
      } else if (file.mimeType === "application/vnd.google-apps.presentation") {
        url = `https://docs.google.com/presentation/d/${file.id}/edit`;
      } else {
        url = `https://drive.google.com/file/d/${file.id}/view`;
      }
      // Only return id, name, mimeType, parents, url
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        parents: file.parents,
        url,
      };
    });
    res.status(200).json(files);
  } catch (err) {
    console.error("[API] Error during list-folder:", err.stack || err);
    res.status(500).send("Error: " + (err.stack || err.message || err));
  }
});

router.post("/convert-docx", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== API_SECRET) {
    return res.status(401).send("Unauthorized: Invalid or missing API key");
  }
  const { from, to, file_id } = req.body;
  if (!from || !to || !file_id) {
    return res
      .status(400)
      .send('Missing "from", "to", or "file_id" in request body');
  }
  try {
    const drive = await getDriveClient();
    // Check that the file exists in the source folder and is a .docx
    const fileRes = await drive.files.get({
      fileId: file_id,
      fields: "id, name, mimeType, parents",
      supportsAllDrives: true,
    });
    const file = fileRes.data;
    if (
      !file.parents ||
      !file.parents.includes(from) ||
      file.mimeType !==
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      return res.status(400).send("File is not a .docx in the source folder");
    }
    const baseName = file.name.replace(/\.docx$/, "");
    // Convert/copy the file as Google Doc into the destination folder
    const copyRes = await drive.files.copy({
      fileId: file_id,
      requestBody: {
        name: baseName,
        parents: [to],
        mimeType: "application/vnd.google-apps.document",
        driveId: DRIVE_ID,
      },
      supportsAllDrives: true,
    });
    const newFile = copyRes.data;
    // Build metadata with url
    let url = `https://docs.google.com/document/d/${newFile.id}/edit`;
    const metadata = {
      id: newFile.id,
      name: newFile.name,
      mimeType: newFile.mimeType,
      parents: newFile.parents,
      url,
    };
    res.status(200).json(metadata);
  } catch (err) {
    console.error("[API] Error in /convert-single-docx:", err.stack || err);
    res.status(500).send("Error: " + (err.stack || err.message || err));
  }
});

export default router;
