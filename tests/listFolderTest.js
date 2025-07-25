import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

export async function listFolderTest(folderId) {
  try {
    const response = await fetch(
      `${
        process.env.DEV ? process.env.DEV_URL : process.env.PROD_URL
      }/list-folder`,
      {
        method: "POST",
        headers: {
          "x-api-key": process.env.API_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ folderId: folderId }),
      }
    );

    const contentType = response.headers.get("content-type");
    if (
      response.ok &&
      contentType &&
      contentType.includes("application/json")
    ) {
      const result = await response.json();
      console.log("Success:", result);
    } else {
      const text = await response.text();
      console.error(`Error ${response.status}:`, text);
    }
  } catch (err) {
    console.error("Network or fetch error:", err);
  }
}

listFolderTest(process.env.SETINBOUND_DOCS);
