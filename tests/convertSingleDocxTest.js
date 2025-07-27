import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

export async function convertSingleDocxTest(sourceFolder, destFolder, fileId) {
  const sourceFolderId = sourceFolder;
  const destFolderId = destFolder;
  const docxFileId = fileId;

  try {
    const response = await fetch(
      `${
        process.env.DEV ? process.env.DEV_URL : process.env.PROD_URL
      }/n8n/convert-docx`,
      {
        method: "POST",
        headers: {
          "x-api-key": process.env.API_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: sourceFolderId,
          to: destFolderId,
          file_id: docxFileId,
        }),
      }
    );

    const text = await response.text();
    if (response.ok) {
      try {
        const data = JSON.parse(text);
        console.log("Success, new file metadata:", data);
      } catch (e) {
        console.log("Success, but could not parse JSON:", text);
      }
    } else {
      console.error(`Error ${response.status}:`, text);
    }
  } catch (err) {
    console.error("Network or fetch error:", err);
  }
}

const fileId = "";

convertSingleDocxTest(
  process.env.SETINBOUND_FOLDER,
  process.env.SETINBOUND_DOCS,
  fileId
);
