import express from "express";
import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import {
  formattedCalendarAvailability,
  minimalCalendarAvailability,
} from "../gCalendar.js";
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

router.post("/calendar-availability", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== API_SECRET) {
    return res.status(401).send("Unauthorized: Invalid or missing API key");
  }

  // Set default values for parameters
  const { utcOffset = "+3", days = 3 } = req.body;

  const currentlyConsts = {
    email: "hello@setinbound.com",
    workStartHour: "9",
    workEndHour: "17",
  };

  try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const result = await formattedCalendarAvailability(
      utcOffset,
      days,
      credentials,
      currentlyConsts.email,
      currentlyConsts.workStartHour,
      currentlyConsts.workEndHour
    );

    const minimalResult = minimalCalendarAvailability(result);
    console.log("Calendar availability:", minimalResult);

    res.status(200).json(minimalResult);
  } catch (error) {
    console.error("Error testing calendar availability:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
