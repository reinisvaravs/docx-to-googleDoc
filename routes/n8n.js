import express from "express";
import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const API_SECRET = process.env.API_SECRET;
const DRIVE_ID = process.env.DRIVE_ID;

router.post("/convert-all-docx", async (req, res) => {
  console.log(`[API] POST /convert-docx received. Body:`, req.body);
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== API_SECRET) {
    console.warn("[API] Unauthorized request: Invalid or missing API key");
    return res.status(401).send("Unauthorized: Invalid or missing API key");
  }
  const { from, to } = req.body;
  if (!from || !to) {
    console.warn('[API] Bad request: Missing "from" or "to" in request body');
    return res.status(400).send('Missing "from" or "to" in request body');
  }
  // Timeout logic
  const timeoutMs = 2 * 60 * 1000; // 2 minutes
  let finished = false;
  const timeout = setTimeout(() => {
    if (!finished) {
      finished = true;
      console.error("[API] Conversion timed out");
      res.status(504).send("Conversion timed out");
    }
  }, timeoutMs);
  try {
    await convertDocx(from, to);
    if (!finished) {
      finished = true;
      clearTimeout(timeout);
      res.status(200).send("Conversion complete!");
    }
  } catch (err) {
    if (!finished) {
      finished = true;
      clearTimeout(timeout);
      console.error("[API] Error during conversion:", err.stack || err);
      res.status(500).send("Error: " + (err.stack || err.message || err));
    }
  }
});

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

async function convertDocx(sourceFolderId, destFolderId) {
  console.log(
    `[convertDocx] Starting conversion: from='${sourceFolderId}' to='${destFolderId}'`
  );
  const drive = await getDriveClient();

  // 1. List ALL files in the destination folder, including trashed
  let allDestFiles = [];
  for (const trashed of [false, true]) {
    const destFilesRes = await drive.files.list({
      q: `'${destFolderId}' in parents and trashed=${trashed}`,
      fields: "files(id, name, mimeType, trashed)",
      driveId: DRIVE_ID,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      corpora: "drive",
    });
    allDestFiles = allDestFiles.concat(destFilesRes.data.files);
  }
  // Remove duplicates by file id
  const seen = new Set();
  allDestFiles = allDestFiles.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
  console.log(
    `[convertDocx] Deleting ${allDestFiles.length} files from destination folder (including trashed)...`
  );
  for (const file of allDestFiles) {
    try {
      await drive.files.delete({
        fileId: file.id,
        supportsAllDrives: true,
      });
      console.log(
        `[convertDocx] Permanently deleted: ${file.name} (${file.id})`
      );
    } catch (err) {
      if (err.message && err.message.includes("File not found")) {
        console.log(`[convertDocx] Already deleted: ${file.name} (${file.id})`);
      } else {
        console.warn(
          `[convertDocx] Could not delete: ${file.name} (${file.id}): ${err.message}`
        );
      }
    }
  }

  // 2. Empty the trash for the shared drive
  try {
    await drive.files.emptyTrash({ driveId: DRIVE_ID });
    console.log(`[convertDocx] Emptied trash for shared drive ${DRIVE_ID}`);
  } catch (err) {
    console.warn(`[convertDocx] Could not empty trash: ${err.message}`);
  }

  // 3. List .docx files in source folder
  const filesRes = await drive.files.list({
    q: `'${sourceFolderId}' in parents and mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' and trashed=false`,
    fields: "files(id, name)",
    driveId: DRIVE_ID,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    corpora: "drive",
  });
  const docxFiles = filesRes.data.files;
  console.log(`[convertDocx] Found ${docxFiles.length} .docx files to convert`);

  // 4. Convert and move each .docx file to destination as Google Doc
  for (const file of docxFiles) {
    const baseName = file.name.replace(/\.docx$/, "");
    try {
      const copyRes = await drive.files.copy({
        fileId: file.id,
        requestBody: {
          name: baseName,
          parents: [destFolderId],
          mimeType: "application/vnd.google-apps.document",
          driveId: DRIVE_ID,
        },
        supportsAllDrives: true,
      });
      console.log(
        `[convertDocx] Converted and copied: ${file.name} -> ${copyRes.data.name}`
      );
    } catch (err) {
      console.warn(
        `[convertDocx] Could not convert/copy: ${file.name}: ${err.message}`
      );
    }
  }
  console.log("[convertDocx] Conversion finished.");
}

export default router;
