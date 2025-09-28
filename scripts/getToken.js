import { google } from 'googleapis';
import readline from 'readline';
import * as dotenv from 'dotenv';

// Load environment variables from a .env file
dotenv.config();

// --- Configuration ---
// The script now reads these values directly from your .env file
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar'
];

// --- Main Authorization Function ---
async function authorize() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    console.error('🔴 Error: Make sure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are set in your .env file.');
    return;
  }

  const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('✅ Step 1: Authorize this app by visiting this URL:\n');
  console.log(authUrl);
  console.log('\n------------------------------------------------------------\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('✅ Step 2: After authorizing, paste the code from the redirect URL here: ', async (code) => {
    rl.close();
    try {
      const { tokens } = await oAuth2Client.getToken(code);
      
      if (tokens.refresh_token) {
        console.log('\n\n============================================================');
        console.log('🔑 YOUR REFRESH TOKEN (SAVE THIS!):\n');
        console.log(tokens.refresh_token);
        console.log('============================================================\n');
        console.log('You can now add this to your .env file as GMAIL_REFRESH_TOKEN.');
      } else {
        console.warn('\n\n🔴 A refresh token was NOT returned. This can happen if you have already authorized this app.');
        console.warn('To fix this, go to https://myaccount.google.com/permissions and remove access for your app, then run this script again.');
      }

    } catch (err) {
      console.error('\n🔴 Error while trying to retrieve access token');
      console.error(err.response ? err.response.data.error_description : err.message);
    }
  });
}

authorize().catch(console.error);