import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { google } from 'googleapis';
import { Pinecone } from '@pinecone-database/pinecone';
import { embed } from 'ai';
import { createWorkflow, createStep } from '@mastra/core/workflows';

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

function authenticate() {
  const oAuth2Client = new google.auth.OAuth2(process.env.CLIENT_ID, process.env.CLIENT_SECRET, "http://localhost");
  oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });
  const calendar = google.calendar({ version: "v3", auth: oAuth2Client });
  return calendar;
}
const getFreeBusyTool = createTool({
  id: "get-free-busy",
  description: "Checks the user's primary calendar for busy time slots within a given date range. This is used to find free time.",
  inputSchema: z.object({
    startTime: z.string().describe("The start of the range to check, in ISO 8601 format, this information can come from the users general description of when they want to place an event"),
    endTime: z.string().describe("The end of the range to check, in ISO 8601 format. this information can come from the users general description of when they want to place an event")
  }),
  outputSchema: z.object({
    busySlots: z.array(z.object({
      start: z.string(),
      end: z.string()
    })).describe("A list of time slots that are already occupied on the calendar.")
  }),
  execute: async ({ context }) => {
    const calendar = authenticate();
    try {
      const response = await calendar.freebusy.query({
        requestBody: {
          timeMin: context.startTime,
          timeMax: context.endTime,
          items: [{ id: "primary" }]
        }
      });
      const rawBusySlots = response.data.calendars?.primary.busy ?? [];
      const busySlots = rawBusySlots.filter((slot) => slot.start && slot.end).map((slot) => ({
        start: slot.start,
        end: slot.end
      }));
      return { busySlots };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get free/busy information: ${errorMessage}`);
    }
  }
});
const getCalendarEventsTool = createTool({
  id: "get-calendar-events",
  description: "Fetches events from the primary Google Calendar within a specified time range. Defaults to today if no range is provided.",
  inputSchema: z.object({
    timeMin: z.string().optional(),
    timeMax: z.string().optional()
  }),
  outputSchema: z.object({
    events: z.array(z.object({
      id: z.string(),
      summary: z.string(),
      start: z.string(),
      end: z.string()
    }))
  }),
  execute: async ({ context }) => {
    const calendar = authenticate();
    const now = /* @__PURE__ */ new Date();
    const timeMin = context.timeMin || new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const timeMax = context.timeMax || new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime"
    });
    const events = (res.data.items || []).map((event) => ({
      id: event.id || "",
      summary: event.summary || "",
      start: event.start?.dateTime || event.start?.date || "",
      end: event.end?.dateTime || event.end?.date || ""
    }));
    return { events };
  }
});
const addCalendarEventTool = createTool({
  id: "add-calendar-event",
  description: "Adds a new event to Google Calendar.",
  inputSchema: z.object({
    summary: z.string(),
    // FIX: Removed .datetime() for more flexible parsing by the Google API
    startTime: z.string().describe(" VERY IMPORTANT: Convert All given times to ISO 8601 format."),
    endTime: z.string().describe(" VERY IMPORTANT: Convert All given times to ISO 8601 format."),
    location: z.string().optional()
  }),
  outputSchema: z.object({
    success: z.boolean(),
    eventId: z.string().optional()
  }),
  execute: async ({ context }) => {
    const calendar = authenticate();
    const newEvent = {
      summary: context.summary,
      start: { dateTime: context.startTime, timeZone: "America/New_York" },
      end: { dateTime: context.endTime, timeZone: "America/New_York" },
      location: context.location
    };
    const createdEvent = await calendar.events.insert({
      calendarId: "primary",
      requestBody: newEvent
    });
    return { success: true, eventId: createdEvent.data.id || void 0 };
  }
});
const deleteCalendarEventTool = createTool({
  id: "delete-calendar-event",
  description: "Deletes a Google Calendar event.",
  inputSchema: z.object({ eventId: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ context }) => {
    const calendar = authenticate();
    await calendar.events.delete({
      calendarId: "primary",
      eventId: context.eventId
    });
    return { success: true };
  }
});
const updateCalendarEventTool = createTool({
  id: "update-calendar-event",
  description: "Updates a Google Calendar event.",
  inputSchema: z.object({
    eventId: z.string(),
    newDate: z.string().optional(),
    newTime: z.string().optional(),
    newLocation: z.string().optional()
  }),
  outputSchema: z.object({
    success: z.boolean()
  }),
  execute: async ({ context }) => {
    const calendar = authenticate();
    const event = await calendar.events.get({
      calendarId: "primary",
      eventId: context.eventId
    });
    const updatedEvent = {
      ...event.data,
      start: context.newDate && context.newTime ? { dateTime: (/* @__PURE__ */ new Date(`${context.newDate}T${context.newTime}`)).toISOString() } : event.data.start,
      end: context.newDate && context.newTime ? { dateTime: new Date((/* @__PURE__ */ new Date(`${context.newDate}T${context.newTime}`)).getTime() + 36e5).toISOString() } : event.data.end,
      // default to 1 hour later
      location: context.newLocation || event.data.location
    };
    await calendar.events.update({
      calendarId: "primary",
      eventId: context.eventId,
      requestBody: updatedEvent
    });
    return { success: true };
  }
});
const calendarTools = {
  getFreeBusyTool,
  getCalendarEventsTool,
  addCalendarEventTool,
  deleteCalendarEventTool,
  updateCalendarEventTool
};

const pc$1 = new Pinecone({ apiKey: "pcsk_2iM6KJ_FyHXqBvDFUFqo4td5eW2L8NY337VQThU6u4MLJpZuAUcHohEXppYG4NQ2VvzuP7" });
const pineconeIndex$1 = pc$1.index("smart-calendar");
const queryHabitsTool = createTool({
  id: "schedule-optimal-event",
  description: "Finds feedback text semantically similar to the user input, then suggests times based on the metadata of the top-k closest vectors.",
  inputSchema: z.object({
    eventtext: z.string().describe('A natural language request for an event to schedule, e.g., "schedule homework for tomorrow".')
  }),
  outputSchema: z.object({
    suggestions: z.array(z.object({
      potstart: z.string().describe("Suggested time for the event, in ISO 8601 format."),
      reason: z.string().describe("Why this time is optimal, based on user feedback and event metadata."),
      eventMetadata: z.record(z.any()).describe("Metadata from the closest matching feedback/event.")
    })).describe("A list of suggested times and reasons for scheduling the event.")
  }),
  execute: async ({ context }) => {
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: context.eventtext
    });
    const queryResult = await pineconeIndex$1.query({
      topK: 5,
      vector: embedding
    });
    console.log("Pinecone matches:");
    queryResult.matches.forEach((match, idx) => {
      console.log(`Match #${idx + 1}: ID=${match.id}`);
      console.log("Metadata:", match.metadata);
    });
    const suggestions = queryResult.matches.map((match) => {
      const meta = match.metadata;
      if (meta && meta.eventStart) {
        return {
          time: meta.eventStart,
          reason: meta.feedback ? `User felt: ${meta.feedback} after event "${meta.eventSummary}".` : `Similar event: "${meta.eventSummary}"`,
          eventMetadata: meta
        };
      }
      return null;
    }).filter((s) => s !== null);
    return { suggestions };
  }
});

const getAgentContext = () => {
  const now = /* @__PURE__ */ new Date();
  const userTimeZone = "America/New_York";
  return `
    **SYSTEM CONTEXT**
    - Current ISO Timestamp (UTC): ${now.toISOString()}
    - User's Local Timezone: ${userTimeZone}
    - Current Local Date & Time for User: ${now.toLocaleString("en-US", { timeZone: userTimeZone })}

    You MUST use this information as the absolute ground truth for all date and time calculations. All user requests like "tonight at 8 PM" are relative to the user's local time. Convert all local times to full ISO 8601 format with timezone offsets before calling any tools.
  `;
};
const calendarAgent = new Agent({
  name: "Calendar Agent",
  instructions: `
    ${getAgentContext()}

    **PERSONA & DIRECTIVES**
    You are an elite, proactive calendar assistant. You are precise, efficient, and silent in your work. 
    You operate by using your tools in the background. You ONLY communicate with the user to ask for essential clarification or to present a final result or proposal. 
    NEVER narrate your plan or explain which tools you are about to use. Perform your work internally and only show the final result.

    **STANDARD OPERATING PROCEDURE**
    1.  **TRIAGE:** First, analyze the user's request to determine the core intent: Scheduling, Viewing, Updating, or Deleting.
    2.  **EXECUTE:** Based on the intent, follow the precise workflow below.

    ---
    **WORKFLOW: SCHEDULING**
    First, determine if it's a **Static Event** or a **Dynamic Task**.
      - **Static (Fixed Time):** The request contains a specific time (e.g., "Meeting at 2 PM").
          - **Action:** Extract all details. Ask for confirmation. On 'yes', call the \`add-calendar-event\` tool.
      - **Dynamic (Flexible Time):** The request has no specific time (e.g., "Schedule homework").
          - **Action:** Execute this intelligent scheduling chain PRECISELY and SILENTLY:
              1. Call \`query-user-habits\` to understand the user's energy patterns.
              2. Call \`get-free-busy\` to find all available time slots.
              3. Synthesize results from steps 1 & 2 to determine the single best time slot.
              4. Propose this optimal slot to the user with a brief reason (e.g., "Based on your habits, you're most focused in the morning. How about 10 AM tomorrow for your homework?").
              5. Await confirmation, then call \`add-calendar-event\`.

    ---
    **WORKFLOW: VIEWING**
    - The request is a question about the schedule (e.g., "What's on my calendar?").
    - **Action:** Use \`get-calendar-events\` with the correct \`timeMin\` and \`timeMax\` derived from the user's request and the current time context. Present the events to the user in a clean list.

    ---
    **WORKFLOW: DELETING / UPDATING**
    - The request is to change or remove an event (e.g., "Move my lunch to 1 PM").
    - **Action:** This is a two-step process.
        1. **Find:** Use \`get-calendar-events\` to find the exact event and its ID. You might need to ask the user for clarification if multiple events match.
        2. **Act:** After confirming the target event with the user, call either \`delete-calendar-event\` or \`calendar-update-tool\` with the correct \`eventId\`.
  `,
  model: openai("gpt-4o-mini"),
  tools: {
    gmailTool,
    ...calendarTools,
    queryHabitsTool
  },
  memory: new Memory({
    storage: new LibSQLStore({
      url: "file:../mastra.db"
    })
  })
});

const pc = new Pinecone({ apiKey: "pcsk_2iM6KJ_FyHXqBvDFUFqo4td5eW2L8NY337VQThU6u4MLJpZuAUcHohEXppYG4NQ2VvzuP7" });
const pineconeIndex = pc.index("smart-calendar");
createTool({
  id: "save-feedback-tool",
  description: "Takes raw user feedback, converts it to an embedding, and saves it to the Pinecone database. This is a complete, one-step action.",
  inputSchema: z.object({
    text: z.string().describe("The user's raw feedback text."),
    userId: z.string().describe("The ID of the user this feedback belongs to."),
    eventMetadata: z.object({
      eventSummary: z.string().describe("Summary/title of the preceding event."),
      eventStart: z.string().describe("Start time of the preceding event in ISO 8601 format."),
      eventEnd: z.string().describe("End time of the preceding event in ISO 8601 format."),
      eventDurationMinutes: z.number().describe("Duration of the event in minutes."),
      eventLocation: z.string().optional().describe("Location of the event.")
    }).optional().describe("Metadata about the closest event before this feedback.")
  }),
  outputSchema: z.object({
    success: z.boolean()
  }),
  execute: async ({ context }) => {
    const { text, userId, eventMetadata } = context;
    console.log(`Embedding text for user ${userId}...`);
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: text
    });
    console.log("Saving vector to Pinecone...");
    await pineconeIndex.upsert([{
      id: `feedback_${Date.now()}_${userId}`,
      values: embedding,
      metadata: {
        userId,
        originalText: text,
        ...eventMetadata || {}
      }
    }]);
    console.log("\u2705 Feedback saved successfully!");
    return { success: true };
  }
});
const feedbackStore = {};
const saveFeedbackTool = createTool({
  id: "save-feedback-tool",
  description: "Stores user feedback (focus, physical, social energy) linked to events for learning scheduling patterns.",
  inputSchema: z.object({
    userId: z.string().describe("The ID of the user this feedback belongs to."),
    eventSummary: z.string().describe("Summary/title of the event."),
    eventStart: z.string().describe("Start time of the event in ISO 8601 format."),
    eventEnd: z.string().describe("End time of the event in ISO 8601 format."),
    feedback: z.object({
      focus: z.number().min(1).max(5).describe("Mental focus during the event (1\u20135)."),
      physical: z.number().min(1).max(5).describe("Physical energy during the event (1\u20135)."),
      social: z.number().min(1).max(5).describe("Mood/social energy during the event (1\u20135).")
    })
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string()
  }),
  execute: async ({ context }) => {
    const { userId, eventSummary, eventStart, eventEnd, feedback } = context;
    if (!feedbackStore[userId]) {
      feedbackStore[userId] = [];
    }
    feedbackStore[userId].push({
      eventSummary,
      eventStart,
      eventEnd,
      ...feedback,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    console.log(`\u2705 Feedback stored for ${userId}:`, feedback);
    return { success: true, message: "Feedback saved successfully." };
  }
});

const knowledgeAgent = new Agent({
  name: "Knowledge Agent",
  instructions: `
You are the Feedback Agent for a smart calendar system.

Your job is to collect simple feedback from the user after each event so the system can learn their energy and focus patterns over time. Keep your tone short, supportive, and conversational.

After each static event (class, meeting, gym, etc.), ask the user these three questions:
1. How focused did you feel during this event? (1\u20135)
2. How physically energized did you feel? (1\u20135)
3. How social or positive was your mood? (1\u20135)

- If the user answers in words (e.g., "pretty tired"), interpret it into a 1\u20135 score.
- Then, call the \`saveFeedbackTool\` with:
  - userId
  - event details (summary, start, end)
  - the three feedback scores.

Never skip calling the tool once feedback is collected. Always confirm to the user: "Thanks, I\u2019ve saved your feedback!"
  `,
  model: openai("gpt-4o-mini"),
  tools: { saveFeedbackTool },
  memory: new Memory({})
});

const initializeAgent = createStep(knowledgeAgent);
const knowledgeSessionWorkflow = createWorkflow({
  id: "knowledge-session-workflow",
  description: "Starts the knowledge agent and asks questions automatically.",
  inputSchema: z.object({}),
  // No input needed
  outputSchema: z.object({
    questions: z.string()
  })
}).map(async ({}) => {
  return {
    prompt: `Ask questions:
1. What is your energy level at this moment?
2. How are you feeling right now?
3. How focused are you?`
  };
}).then(initializeAgent).commit();

const mastra = new Mastra({
  workflows: {
    knowledgeSessionWorkflow
  },
  agents: {
    calendarAgent,
    knowledgeAgent
  },
  storage: new LibSQLStore({
    url: ":memory:"
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info"
  })
});

export { mastra };
