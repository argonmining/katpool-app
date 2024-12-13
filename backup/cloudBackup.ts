import { createReadStream, access, constants } from 'fs';
import path from 'path';
import { google } from 'googleapis';
import config from '../config/config.json'
import googleCredentials from './google-credentials.json';

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const fileNameArgs = process.argv.slice(2); 

async function authorize() {
    const jwtClient = new google.auth.JWT(
        googleCredentials.client_email,
        undefined,
        googleCredentials.private_key,
        SCOPES
    );
    await jwtClient.authorize();
    return jwtClient;
}

async function uploadFile(authClient: any) {
    const drive = google.drive({ version: "v3", auth: authClient });

    for(let i = 0; i < fileNameArgs.length; i++) {
        access(fileNameArgs[i], constants.F_OK, async (err) => {
            if (err) {
                console.log(`The file ${fileNameArgs[i]} does not exist in the current directory.`);
            } else {
                const file = await drive.files.create({
                    media: {
                        body: createReadStream(fileNameArgs[i]),
                    },
                    fields: "id",
                    requestBody: {
                        name: path.basename(fileNameArgs[i]),
                    },
                });
                console.log("File Uploaded :", file.data.id);
                const backupEmailAddress = config.backupEmailAddress
                await drive.permissions.create({ fileId: file.data.id!, requestBody: { type: 'user', role: 'writer', emailAddress: backupEmailAddress } })
            }
        });
    }
}

(async function main() {
    const authClient = await authorize();
    await uploadFile(authClient);
})()

