import express from "express";
import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import {
  formattedCalendarAvailability,
  minimalCalendarAvailability,
  scheduleMeeting,
} from "../gCalendar.js";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const API_SECRET = process.env.API_SECRET; // array of secrets
const DRIVE_ID = process.env.DRIVE_ID;

// Multer configuration for file uploads
const upload = multer({ dest: "uploads/" });

// __dirname replacement for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// .docx to Google Doc
router.post("/convert-docx", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || !API_SECRET.includes(apiKey)) {
    return res.status(401).send("Unauthorized: Invalid or missing API key");
  }

  // Match name and ID
  const match = apiKey.match(/^([^_]+)_(\d+)$/);

  if (match) {
    const apiName = match[1];
    const apiId = match[2];
    console.log("API Name:", apiName); // name
    console.log(`API ID: ${apiId && "found successfully"}`); // id
  } else {
    console.log("Invalid API key format");
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

// Convert audio file to specified format
router.post("/convert-audio", upload.single("file"), (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || !API_SECRET.includes(apiKey)) {
    return res.status(401).send("Unauthorized: Invalid or missing API key");
  }

  // Match name and ID
  const match = apiKey.match(/^([^_]+)_(\d+)$/);

  if (match) {
    const apiName = match[1];
    const apiId = match[2];
    console.log("API Name:", apiName); // name
    console.log(`API ID: ${apiId && "found successfully"}`); // id
  } else {
    console.log("Invalid API key format");
  }

  if (!req.file) {
    return res.status(400).send("No file uploaded");
  }

  // Ensure converted folder exists (only when this route is called)
  const convertedDir = path.join(__dirname, "..", "converted");
  if (!fs.existsSync(convertedDir)) {
    fs.mkdirSync(convertedDir, { recursive: true });
  }

  // Get output format from query parameter or default to mp3
  const outputFormat = req.query.format || "mp3";

  // Validate output format
  const supportedFormats = [
    "flac",
    "m4a",
    "mp3",
    "mp4",
    "mpeg",
    "mpga",
    "oga",
    "ogg",
    "wav",
    "webm",
  ];
  if (!supportedFormats.includes(outputFormat)) {
    return res.status(400).json({
      error: `Unsupported format: ${outputFormat}. Supported formats: ${supportedFormats.join(
        ", "
      )}`,
    });
  }

  const inputPath = req.file.path;
  const outputPath = path.join(convertedDir, `${Date.now()}.${outputFormat}`);

  ffmpeg(inputPath)
    .toFormat(outputFormat)
    .on("end", () => {
      const fileStream = fs.createReadStream(outputPath);

      // Set appropriate content type based on format
      const contentTypes = {
        flac: "audio/flac",
        m4a: "audio/mp4",
        mp3: "audio/mpeg",
        mp4: "video/mp4",
        mpeg: "audio/mpeg",
        mpga: "audio/mpeg",
        oga: "audio/ogg",
        ogg: "audio/ogg",
        wav: "audio/wav",
        webm: "audio/webm",
      };

      res.setHeader("Content-Type", contentTypes[outputFormat] || "audio/mpeg");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=converted.${outputFormat}`
      );
      fileStream.pipe(res);

      fileStream.on("end", () => {
        // Clean up temporary files
        try {
          fs.unlinkSync(inputPath);
          fs.unlinkSync(outputPath);
        } catch (err) {
          console.error("Error cleaning up files:", err);
        }
      });
    })
    .on("error", (err) => {
      console.error("FFmpeg error:", err.message);
      // Clean up input file on error
      try {
        fs.unlinkSync(inputPath);
      } catch (cleanupErr) {
        console.error("Error cleaning up input file:", cleanupErr);
      }
      res.status(500).json({ error: "Audio conversion failed" });
    })
    .save(outputPath);
});

// Simple file type checker
router.post("/identify-file-type", (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || !API_SECRET.includes(apiKey)) {
    return res.status(401).send("Unauthorized: Invalid or missing API key");
  }

  // Match name and ID
  const match = apiKey.match(/^([^_]+)_(\d+)$/);

  if (match) {
    const apiName = match[1];
    const apiId = match[2];
    console.log("API Name:", apiName); // name
    console.log(`API ID: ${apiId && "found successfully"}`); // id
  } else {
    console.log("Invalid API key format");
  }

  const body = req.body || {};
  const { url } = body;
  if (!url) {
    return res.status(400).send("Missing 'url' in request body");
  }

  // Simple extension checker
  const lowerUrl = url.toLowerCase();

  // Image extensions
  const imageExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".webp",
    ".tiff",
    ".svg",
  ];
  for (const ext of imageExtensions) {
    if (lowerUrl.includes(ext)) {
      return res.status(200).json({ type: "image", format: ext.substring(1) });
    }
  }

  // Audio extensions
  const audioExtensions = [
    ".mp3",
    ".wav",
    ".ogg",
    ".m4a",
    ".flac",
    ".aac",
    ".webm",
    ".mpga",
    ".mpeg",
    ".oga",
    ".opus",
  ];
  for (const ext of audioExtensions) {
    if (lowerUrl.includes(ext)) {
      return res.status(200).json({ type: "audio", format: ext.substring(1) });
    }
  }

  // No recognized extension found
  return res.status(200).json({ type: "unknown", format: "none" });
});

// Schedule a meeting
router.post("/schedule-meeting", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || !API_SECRET.includes(apiKey)) {
    return res.status(401).send("Unauthorized: Invalid or missing API key");
  }

  // Match name and ID
  const match = apiKey.match(/^([^_]+)_(\d+)$/);

  if (match) {
    const apiName = match[1];
    const apiId = match[2];
    console.log("API Name:", apiName); // name
    console.log(`API ID: ${apiId && "found successfully"}`); // id
  } else {
    console.log("Invalid API key format");
  }

  const body = req.body || {};
  const { start, end, summary, description = "", email } = body;

  if (!start || !end || !summary || !email) {
    return res
      .status(400)
      .send("Missing required parameters: start, end, summary, email");
  }

  try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

    const result = await scheduleMeeting({
      start,
      end,
      summary,
      description,
      attendees: [{ email }],
      google_service_account_key: credentials,
      google_calendar_email: email,
    });

    if (result.error) {
      console.error("Error scheduling meeting:", result.error);
      return res.status(500).json({ error: result.error });
    }

    console.log("Meeting scheduled successfully:", result);
    res.status(200).json(result);
  } catch (error) {
    console.error("Error in schedule-meeting:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get calendar availability
router.post("/calendar-availability", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || !API_SECRET.includes(apiKey)) {
    return res.status(401).send("Unauthorized: Invalid or missing API key");
  }

  // Match name and ID
  const match = apiKey.match(/^([^_]+)_(\d+)$/);

  if (match) {
    const apiName = match[1];
    const apiId = match[2];
    console.log("API Name:", apiName); // name
    console.log(`API ID: ${apiId && "found successfully"}`); // id
  } else {
    console.log("Invalid API key format");
  }

  // Set default values for parameters (body is optional)
  const body = req.body || {};
  const utcOffset = body.utcOffset || "+3";
  const days = body.days || 3;

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
