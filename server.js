import dotenv from "dotenv";
dotenv.config();
import express from "express";
import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { convertDocxTest } from "./test.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3001;
const API_SECRET = process.env.API_SECRET;
const DRIVE_ID = "0AMHmhRM6nNHdUk9PVA"; // Your Shared Drive ID

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

  // List .docx files in source folder in the Shared Drive
  const filesRes = await drive.files.list({
    q: `'${sourceFolderId}' in parents and mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' and trashed=false`,
    fields: "files(id, name)",
    driveId: DRIVE_ID,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    corpora: "drive",
  });

  for (const file of filesRes.data.files) {
    const copyRes = await drive.files.copy({
      fileId: file.id,
      requestBody: {
        name: file.name.replace(/\.docx$/, ""),
        parents: [destFolderId],
        mimeType: "application/vnd.google-apps.document",
        driveId: DRIVE_ID,
      },
      supportsAllDrives: true,
    });
    console.log(
      `[convertDocx] Converted and copied: ${file.name} -> ${copyRes.data.name}`
    );
  }
  console.log("[convertDocx] Conversion finished.");
}

app.post("/convert-docx", async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
});

convertDocxTest("1qRJQ3Umz2XTwo2XAC5tKv29-BqiLQ4HX", "1sJi6_nzSbpBzOBc1jhdtUKFafGozL89Q")