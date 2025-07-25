import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

export async function convertDocxTest(sourceFolder, destFolder) {
  const sourceFolderId = sourceFolder;
  const destFolderId = destFolder;

  try {
    const response = await fetch(
      `${
        process.env.DEV ? process.env.DEV_URL : process.env.PROD_URL
      }/convert-docx`,
      {
        method: "POST",
        headers: {
          "x-api-key": process.env.API_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: sourceFolderId, to: destFolderId }),
      }
    );

    const text = await response.text();
    if (response.ok) {
      console.log("Success:", text);
    } else {
      console.error(`Error ${response.status}:`, text);
    }
  } catch (err) {
    console.error("Network or fetch error:", err);
  }
}

convertDocxTest(process.env.SETINBOUND_FOLDER, process.env.SETINBOUND_DOCS);
