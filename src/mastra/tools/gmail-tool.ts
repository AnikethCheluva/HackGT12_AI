import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { google } from 'googleapis';

export const gmailTool = createTool({
  id: 'get-gmail-emails',
  description: 'Searches a Gmail account for emails that match a specific query.',
  inputSchema: z.object({
    query: z.string().describe(
      "The search query for Gmail, e.g., 'invitation', 'RSVP', 'meeting request'."
    ),
  }),
  // The output is simple again, with no calculated date field.
  outputSchema: z.object({
    emails: z.array(z.object({
      id: z.string(),
      snippet: z.string(),
      subject: z.string(),
      from: z.string(),
    })),
  }),
  execute: async ({ context }) => {
    
    const CLIENT_ID = '237620176891-5a0ogdie8jq95v4kbqv76jd0qrtnn3m8.apps.googleusercontent.com';
    const CLIENT_SECRET = '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';
    const REFRESH_TOKEN = '1//01zTTWgfSMAjECgYIARAAGAESNwF-L9IrwVSdVVaZ2GmQk5B1QjDYGbyudBbq-aK5k3qZF2KlerR7gbU256RKsgFy6CmrxV_zQW8';

    const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, 'http://localhost');
    oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    try {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: context.query,
        maxResults: 5,
      });

      const messages = res.data.messages || [];
      if (messages.length === 0) { 
        return { emails: [] }; 
      }

      const emails = await Promise.all(
        messages.map(async (message) => {
          if (message.id) {
            const msg = await gmail.users.messages.get({ userId: 'me', id: message.id });
            const headers = msg.data.payload?.headers;
            const subject = headers?.find((h) => h.name === 'Subject')?.value || '';
            const from = headers?.find((h) => h.name === 'From')?.value || '';

            return {
              id: message.id,
              snippet: msg.data.snippet || '',
              subject,
              from,
            };
          }
          return null;
        })
      );
      
      const validEmails = emails.filter(email => email !== null);
      return { emails: validEmails as any };

    } catch (error) {
      console.error('The API returned an error: ' + error);
      throw new Error('Failed to fetch emails from Gmail.');
    }
  },
});