// src/tools/queryPineconeTool.ts
import { createTool } from '@mastra/core/tools';
import { Pinecone } from '@pinecone-database/pinecone';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import { z } from 'zod';

// Initialize clients once
const pc = new Pinecone({ apiKey: 'pcsk_2iM6KJ_FyHXqBvDFUFqo4td5eW2L8NY337VQThU6u4MLJpZuAUcHohEXppYG4NQ2VvzuP7' });
const pineconeIndex = pc.index('smart-calendar');

export const queryHabitsTool = createTool({
  id: 'schedule-optimal-event',
  description: 'Automatically finds the most appropriate time to schedule an event (e.g., "schedule homework for tomorrow") based on user feedback after previous events.',
  inputSchema: z.object({
    event: z.string().describe('A natural language request for an event to schedule, e.g., "schedule homework for tomorrow".'),
  }),
  outputSchema: z.object({
    suggestions: z.array(z.object({
      time: z.string().describe('Suggested time for the event, in ISO 8601 format.'),
      reason: z.string().describe('Why this time is optimal, based on user feedback.'),
    })).describe('A list of suggested times and reasons for scheduling the event.'),
  }),
  execute: async ({ context }) => {
    // 1. Embed the event request
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: context.event,
    });

    // 2. Query Pinecone for top matches (events with positive feedback after intensive tasks)
    const queryResult = await pineconeIndex.query({
      topK: 5,
      vector: embedding,
      // You may want to filter for events with feedback metadata
      // filter: { userId: 'user_abc', feedback: { $exists: true } }
    });

    // 3. Find time slots after events where user feedback was positive (e.g., felt focused, energized)
    const suggestions = queryResult.matches
      .map(match => {
        const meta = match.metadata as {
          originalText: string;
          eventTime: string; // ISO 8601
          feedback: string;
        };
        // Example: Only suggest times after events with positive feedback
        if (meta && meta.eventTime && meta.feedback && /positive|energized|focused|productive/i.test(meta.feedback)) {
          return {
            time: meta.eventTime,
            reason: `User felt ${meta.feedback} after this time slot.`,
          };
        }
        return null;
      })
      .filter(s => s !== null);

    return { suggestions };
  },
});

