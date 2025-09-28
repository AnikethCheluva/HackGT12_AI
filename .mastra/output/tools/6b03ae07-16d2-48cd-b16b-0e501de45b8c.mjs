import { createTool } from '@mastra/core/tools';
import { Pinecone } from '@pinecone-database/pinecone';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import { z } from 'zod';

const pc = new Pinecone({ apiKey: "pcsk_2iM6KJ_FyHXqBvDFUFqo4td5eW2L8NY337VQThU6u4MLJpZuAUcHohEXppYG4NQ2VvzuP7" });
const pineconeIndex = pc.index("smart-calendar");
const embedFeedbackTool = createTool({
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
function getUserFeedback(userId) {
  return feedbackStore[userId] || [];
}

export { embedFeedbackTool, getUserFeedback, saveFeedbackTool };
