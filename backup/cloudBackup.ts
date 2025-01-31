import { exec } from "child_process";
import { google } from "googleapis";
import cron from 'node-cron'; 
import * as cronParser from 'cron-parser';
import Monitoring from '../src/monitoring'
import config from "../config/config.json";
import googleCredentials from "./google-credentials.json";
import path from "path";
import { cronValidation } from "../src/cron-schedule";

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const backupScriptPath = path.resolve(__dirname, "backup.sh");
const backupCronSchedule = cronValidation(config.backupCronSchedule); // Defaults to twice a day if not set

const backupEmailAddress = config.backupEmailAddress || "socials@onargon.com";

const monitoring = new Monitoring();

const interval = cronParser.parseExpression(backupCronSchedule);

monitoring.log("CloudBackup: Starting Katpool backup")
monitoring.log(`CloudBackup: Backup is scheduled with cron : ${backupCronSchedule}`)
const nextScedule = new Date(interval.next().getTime()).toISOString();
monitoring.log(`CloudBackup: First backup is scheduled at : ${nextScedule}`)

// Google Drive API authorization
async function authorize() {
    const formattedPrivateKey = googleCredentials.private_key.replace(/\\n/g, "\n");
    const jwtClient = new google.auth.JWT(
        googleCredentials.client_email,
        undefined,
        formattedPrivateKey,
        SCOPES
    );
    await jwtClient.authorize();
    return jwtClient;
}

// Upload file to Google Drive
async function uploadFile(authClient: any, fileName: string) {
    const drive = google.drive({ version: "v3", auth: authClient });
    try {
        const file = await drive.files.create({
            media: { body: require("fs").createReadStream(fileName) },
            fields: "id",
            requestBody: { name: fileName.split("/").pop() },
        });
        monitoring.log(`CloudBackup: File Uploaded: ${file.data.id}`);

        await drive.permissions.create({
            fileId: file.data.id!,
            requestBody: {
                type: "user",
                role: "writer",
                emailAddress: backupEmailAddress,
            },
        });
        monitoring.log(`CloudBackup: Permission granted to: ${backupEmailAddress}`);
    } catch (err) {
        monitoring.error(`CloudBackup: Uploading file ${fileName}: ${err.message}`);
    }
}

// Run backup and upload process
async function runBackupAndUpload() {
    monitoring.log(`CloudBackup: Starting backup...`);

    exec(`bash ${backupScriptPath}`, async (error, stdout, stderr) => {
        if (error) {
            monitoring.error(`CloudBackup: Backup script error: ${stderr}`);
            return;
        }

        const output = stdout.trim();
        monitoring.log(`CloudBackup: Backup script output: ${output}`);

        // Extract the backup filename from the output
        const match = output.match(/Backup completed: (.+\.gz)/);
        if (match && match[1]) {
            const backupFile = match[1];
            monitoring.log(`CloudBackup: Backup file identified: ${backupFile}`);

            const authClient = await authorize();
            await uploadFile(authClient, backupFile);
        } else {
            monitoring.error(`CloudBackup: Backup file not identified in the script output.`);
        }
    });
}

// Schedule the job based on the interval
cron.schedule(backupCronSchedule, async () => {
    monitoring.log(`Scheduled backup and upload started at ${new Date().toISOString()}`);    

    // We are waiting for a delay after the payment cycle, before pushing the DB dump to Google drive.
    const delay = (2 * 60 * 1000); // Convert to milliseconds

    // Wait for the delay before executing the backup and upload
    setTimeout(async () => {
        monitoring.log(`CloudBackup: Running backup and upload after delay at ${new Date().toISOString()}`);
        await runBackupAndUpload();
    }, delay);
});