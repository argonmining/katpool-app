import { createReadStream } from 'fs';
import path from 'path';
import { google } from 'googleapis';
// import google-credentials.json

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const fileName = "<BACKUP-SQL-FILE-PATH>";

async function authorize() {
    const jwtClient = new google.auth.JWT(
        undefined, // google_credentials.client_email,
        undefined,
        undefined,// google_credentials.private_key,
        SCOPES
    );
    await jwtClient.authorize();
    return jwtClient;
}

async function uploadFile(authClient: any) {
    const drive = google.drive({ version: "v3", auth: authClient });

    const file = await drive.files.create({
        media: {
            body: createReadStream(fileName),
        },
        fields: "id",
        requestBody: {
            name: path.basename(fileName),
        },
    });
    console.log("File Uploaded :", file.data.id);
    await drive.permissions.create({ fileId: file.data.id!, requestBody: { type: 'user', role: 'writer', emailAddress: 'parth.p@knackroot.com' } })
}

(async function main() {
    const authClient = await authorize();
    await uploadFile(authClient);
})()

