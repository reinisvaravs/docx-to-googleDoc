const fs = require("fs");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");

async function main() {
  // Authenticate and get Drive API client
  const auth = await authenticate({
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/drive.file",
    ],
    keyfilePath: __dirname + "/credentials.json", // Use absolute path
  });
  const drive = google.drive({ version: "v3", auth });

  // Get folder IDs by name
  async function getFolderIdByName(name) {
    const res = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`,
      fields: "files(id, name)",
      spaces: "drive",
    });
    if (!res.data.files.length) throw new Error(`Folder '${name}' not found`);
    return res.data.files[0].id;
  }

  const sourceFolder = "setinbound_folder";
  const destFolder = "setinbound_docs";
  const sourceFolderId = await getFolderIdByName(sourceFolder);
  const destFolderId = await getFolderIdByName(destFolder);

  // List .docx files in source folder
  const filesRes = await drive.files.list({
    q: `'${sourceFolderId}' in parents and mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' and trashed=false`,
    fields: "files(id, name)",
  });

  for (const file of filesRes.data.files) {
    // Export as Google Doc by copying and converting
    const copyRes = await drive.files.copy({
      fileId: file.id,
      requestBody: {
        name: file.name.replace(/\.docx$/, ""),
        parents: [destFolderId],
        mimeType: "application/vnd.google-apps.document",
      },
    });
    console.log(`Converted and copied: ${file.name} -> ${copyRes.data.name}`);
  }
}

main().catch(console.error);
