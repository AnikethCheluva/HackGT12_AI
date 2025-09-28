import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { google } from 'googleapis';

const gmailTool = createTool({
  id: "get-gmail-emails",
  description: "Searches a Gmail account for emails that match a specific query.",
  inputSchema: z.object({
    query: z.string().describe(
      "The search query for Gmail, e.g., 'invitation', 'RSVP', 'meeting request'."
    )
  }),
  // The output is simple again, with no calculated date field.
  outputSchema: z.object({
    emails: z.array(z.object({
      id: z.string(),
      snippet: z.string(),
      subject: z.string(),
      from: z.string()
    }))
  }),
  execute: async ({ context }) => {
    const CLIENT_ID = process.env.CLIENT_ID;
    const CLIENT_SECRET = process.env.CLIENT_SECRET;
    const REFRESH_TOKEN = process.env.REFRESH_TOKEN;
    const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, "http://localhost");
    oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
    try {
      const res = await gmail.users.messages.list({
        userId: "me",
        q: context.query,
        maxResults: 5
      });
      const messages = res.data.messages || [];
      if (messages.length === 0) {
        return { emails: [] };
      }
      const emails = await Promise.all(
        messages.map(async (message) => {
          if (message.id) {
            const msg = await gmail.users.messages.get({ userId: "me", id: message.id });
            const headers = msg.data.payload?.headers;
            const subject = headers?.find((h) => h.name === "Subject")?.value || "";
            const from = headers?.find((h) => h.name === "From")?.value || "";
            return {
              id: message.id,
              snippet: msg.data.snippet || "",
              subject,
              from
            };
          }
          return null;
        })
      );
      const validEmails = emails.filter((email) => email !== null);
      return { emails: validEmails };
    } catch (error) {
      console.error("The API returned an error: " + error);
      throw new Error("Failed to fetch emails from Gmail.");
    }
  }
});

export { gmailTool };
