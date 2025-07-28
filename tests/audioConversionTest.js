import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import FormData from "form-data";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function audioConversionTest(audioFilePath) {
  try {
    if (!fs.existsSync(audioFilePath)) {
      console.error(`Audio file not found: ${audioFilePath}`);
      return;
    }

    const formData = new FormData();
    formData.append("file", fs.createReadStream(audioFilePath));

    const response = await fetch(`http://localhost:8383/n8n/convert-audio`, {
      method: "POST",
      headers: {
        "x-api-key": process.env.API_SECRET,
      },
      body: formData,
    });

    if (response.ok) {
      const buffer = await response.arrayBuffer();
      const outputPath = path.join(
        __dirname,
        "..",
        "converted",
        "test_output.mp3"
      );

      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      fs.writeFileSync(outputPath, Buffer.from(buffer));
      console.log("Success: Audio converted and saved to", outputPath);
    } else {
      const text = await response.text();
      console.error(`Error ${response.status}:`, text);
    }
  } catch (err) {
    console.error("Network or fetch error:", err);
  }
}

// Example usage (uncomment and provide a test audio file path)
audioConversionTest("./test.opus");
