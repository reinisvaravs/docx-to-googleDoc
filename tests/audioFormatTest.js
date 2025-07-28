import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import FormData from "form-data";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function testAudioFormats() {
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
  const testFile = "./test.opus"; // Your test audio file

  if (!fs.existsSync(testFile)) {
    console.error(`Test file not found: ${testFile}`);
    return;
  }

  console.log("Testing all supported audio formats...");

  for (const format of supportedFormats) {
    try {
      console.log(`Testing conversion to ${format}...`);

      const formData = new FormData();
      formData.append("file", fs.createReadStream(testFile));

      const response = await fetch(
        `http://localhost:8383/n8n/convert-audio?format=${format}`,
        {
          method: "POST",
          headers: {
            "x-api-key": process.env.API_SECRET,
          },
          body: formData,
        }
      );

      if (response.ok) {
        const buffer = await response.arrayBuffer();
        const outputPath = path.join(
          __dirname,
          "..",
          "converted",
          `test_${format}.${format}`
        );

        // Ensure output directory exists
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(outputPath, Buffer.from(buffer));
        console.log(`✅ ${format}: Success (${buffer.byteLength} bytes)`);
      } else {
        const text = await response.text();
        console.error(`❌ ${format}: Error ${response.status} - ${text}`);
      }
    } catch (err) {
      console.error(`❌ ${format}: Network error - ${err.message}`);
    }
  }
}

// Run the test
testAudioFormats();
