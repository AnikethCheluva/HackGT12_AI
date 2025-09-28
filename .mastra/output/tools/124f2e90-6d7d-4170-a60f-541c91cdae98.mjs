import { createTool } from '@mastra/core/tools';
import { Pinecone } from '@pinecone-database/pinecone';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import { z } from 'zod';

const pc = new Pinecone({ apiKey: "pcsk_2iM6KJ_FyHXqBvDFUFqo4td5eW2L8NY337VQThU6u4MLJpZuAUcHohEXppYG4NQ2VvzuP7" });
const pineconeIndex = pc.index("smart-calendar");
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
    const queryResult = await pineconeIndex.query({
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

export { queryHabitsTool };
