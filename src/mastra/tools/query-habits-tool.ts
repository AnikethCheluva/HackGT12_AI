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
  id: 'query-user-habits',
  description: 'Searches the user\'s memory for relevant habits, feelings, or patterns based on a conceptual query.',
  inputSchema: z.object({
    query: z.string().describe('A conceptual query about the user\'s habits, e.g., "user focus and energy levels" or "feelings after meetings".'),
  }),
  outputSchema: z.object({
    results: z.array(z.string()).describe('A list of the most relevant memories or habits found.'),
  }),
  execute: async ({ context }) => {
    // 1. Embed the conceptual query
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: context.query,
    });

    // 2. Query Pinecone with the vector
    const queryResult = await pineconeIndex.query({
      topK: 5, // Get the top 5 most relevant results
      vector: embedding,
      // NOTE: In a real multi-user app, you'd filter by userId here
      // filter: { userId: 'user_abc' }
    });

    // 3. Return the original text from the results' metadata
    const results = queryResult.matches
      .map(match => (match.metadata as { originalText: string })?.originalText)
      .filter(text => text); // Filter out any undefined results

    return { results };
  },
});