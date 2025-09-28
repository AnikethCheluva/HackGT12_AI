import { google } from 'googleapis';
import readline from 'readline';
import { embedFeedbackTool } from '../src/mastra/tools/embedd-tool'; // Adjust path as needed

const POLL_INTERVAL = 1 * 60 * 1000; // 1 minute

// Set up OAuth2 client
const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  'http://localhost'
);
oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

let lastPollTime = new Date().toISOString();

function askFeedbackQuestions(event) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log(`\nEvent "${event.summary}" ended at ${event.end.dateTime || event.end.date}`);
    rl.question('How was your energy level (1-5)? ', (energy) => {
      rl.question('How was your focus (1-5)? ', (focus) => {
        rl.question('Any notes about how you felt? ', (note) => {
          rl.close();
          resolve({
            energy: Number(energy),
            focus: Number(focus),
            note
          });
        });
      });
    });
  });
}

async function pollEndedEvents() {
  const now = new Date().toISOString();
  try {
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: lastPollTime,
      timeMax: now,
      singleEvents: true,
      orderBy: 'endTime',
    });

    const endedEvents = (res.data.items || []).filter(event => {
      const end = event.end?.dateTime || event.end?.date;
      return end && new Date(end) <= new Date(now);
    });

    for (const event of endedEvents) {
      const feedback = await askFeedbackQuestions(event);

      // Store feedback using embedFeedbackTool
      await embedFeedbackTool.run({
        text: feedback.note,
        userId: process.env.USER_ID || 'default_user',
        eventMetadata: {
          eventSummary: event.summary,
          eventStart: event.start.dateTime || event.start.date,
          eventEnd: event.end.dateTime || event.end.date,
          eventDurationMinutes: Math.round(
            (new Date(event.end.dateTime || event.end.date) - new Date(event.start.dateTime || event.start.date)) / 60000
          ),
          eventLocation: event.location || '',
          energy: feedback.energy,
          focus: feedback.focus,
          timestamp: now
        }
      });

      console.log('✅ Feedback stored for event:', event.summary);
    }
  } catch (err) {
    console.error('Error polling calendar:', err);
  }
  lastPollTime = now;
}

// Initial poll and set interval
pollEndedEvents();
setInterval(pollEndedEvents, POLL_INTERVAL);