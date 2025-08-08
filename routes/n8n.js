import express from "express";
import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

// Multer configuration for file uploads
const upload = multer({
  dest: "uploads/",
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      // Create uploads directory if it doesn't exist
      const uploadDir = "uploads/";
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
      cb(null, file.originalname);
    },
  }),
});

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
  const config = JSON.parse(process.env.ALL_CONFIGS)[apiKey];
  const drive_id = config.drive_id;

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

    // Convert/copy the file as Google Doc into the "from" folder
    const copyRes = await drive.files.copy({
      fileId: file_id,
      requestBody: {
        name: baseName,
        parents: [from],
        mimeType: "application/vnd.google-apps.document",
        driveId: drive_id,
      },
      supportsAllDrives: true,
    });
    const newFile = copyRes.data;

    // Move the original file to the "to" folder
    await drive.files.update({
      fileId: file_id,
      addParents: to,
      removeParents: from,
      supportsAllDrives: true,
    });

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

router.post("/get_message_by_id", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  const config = JSON.parse(process.env.ALL_CONFIGS)[apiKey];
  const SUPABASE_API_KEY = config.SUPABASE_API_KEY;

  const { message_id, session_id } = req.body;
  console.log(message_id, session_id);

  if (!message_id || !session_id) {
    return res
      .status(400)
      .send("Missing message_id or session_id in request body");
  }

  console.log(message_id, session_id);

  const response = await fetch(
    `https://dkpougltgangqvyyuzha.supabase.co/rest/v1/formatted_history?session_id=eq.${session_id}&select=all_history`,
    {
      headers: {
        apikey: SUPABASE_API_KEY,
        Authorization: `Bearer ${SUPABASE_API_KEY}`,
      },
    }
  );

  const data = await response.json();

  const output = data[0].all_history;

  for (let i = 1; i < output.length; i++) {
    if (output[output.length - i].message_id === message_id) {
      console.log(output[output.length - i].content);
      return res.status(200).json({
        content: output[output.length - i].content,
        message_id: output[output.length - i].message_id,
      });
    }
  }
  return res.status(200).json({ content: "Message not found" });
});

export default router;
