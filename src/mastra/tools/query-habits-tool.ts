// src/tools/queryPineconeTool.ts
import { createTool } from '@mastra/core/tools';
import { Pinecone } from '@pinecone-database/pinecone';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import { z } from 'zod';

// Initialize clients once
const pc =  new Pinecone({ apiKey: 'pcsk_2iM6KJ_FyHXqBvDFUFqo4td5eW2L8NY337VQThU6u4MLJpZuAUcHohEXppYG4NQ2VvzuP7' });
const pineconeIndex = pc.index('smart-calendar');

export const queryHabitsTool = createTool({
  id: 'schedule-optimal-event',
  description: 'Finds feedback text semantically similar to the user input, then suggests times based on the metadata of the top-k closest vectors.',
  inputSchema: z.object({
    eventtext: z.string().describe('A natural language request for an event to schedule, e.g., "schedule homework for tomorrow".'),
  }),
  outputSchema: z.object({
    suggestions: z.array(z.object({
      potstart: z.string().describe('Suggested time for the event, in ISO 8601 format.'),
      reason: z.string().describe('Why this time is optimal, based on user feedback and event metadata.'),
      eventMetadata: z.record(z.any()).describe('Metadata from the closest matching feedback/event.'),
    })).describe('A list of suggested times and reasons for scheduling the event.'),
  }),
  execute: async ({ context }) => {
    // 1. Embed the event request
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: context.eventtext,
    });

    // 2. Query Pinecone for top matches (feedback text similar to the event)
    const queryResult = await pineconeIndex.query({
      topK: 5,
      vector: embedding,
    });

    // Debug: Log all matches and their metadata
    console.log('Pinecone matches:');
    queryResult.matches.forEach((match, idx) => {
      console.log(`Match #${idx + 1}: ID=${match.id}`);
      console.log('Metadata:', match.metadata);
    });

    // 3. Use metadata from top matches to suggest times
    const suggestions = queryResult.matches
      .map(match => {
        const meta = match.metadata as {
          originalText: string;
          eventSummary?: string;
          eventStart?: string;
          eventEnd?: string;
          eventDurationMinutes?: number;
          eventLocation?: string;
          feedback?: string;
        };
        // Suggest the start time of the event as a possible slot, with reason from feedback
        if (meta && meta.eventStart) {
          return {
            time: meta.eventStart,
            reason: meta.feedback
              ? `User felt: ${meta.feedback} after event \"${meta.eventSummary}\".`
              : `Similar event: \"${meta.eventSummary}\"`,
            eventMetadata: meta,
          };
        }
        return null;
      })
      .filter(s => s !== null);

    return { suggestions };
  },
});

