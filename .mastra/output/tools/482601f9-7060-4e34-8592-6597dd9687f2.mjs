import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { google } from 'googleapis';

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

export { calendarTools };
