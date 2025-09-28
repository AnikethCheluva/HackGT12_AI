// src/tools/saveFeedbackTool.ts
import { createTool } from '@mastra/core/tools';
import { Pinecone } from '@pinecone-database/pinecone';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import { z } from 'zod';

// Initialize clients once
const pc = new Pinecone({ apiKey: 'pcsk_2iM6KJ_FyHXqBvDFUFqo4td5eW2L8NY337VQThU6u4MLJpZuAUcHohEXppYG4NQ2VvzuP7'});
const pineconeIndex = pc.index('smart-calendar');

export const embedFeedbackTool = createTool({
  id: 'save-feedback-tool',
  description: "Takes raw user feedback, converts it to an embedding, and saves it to the Pinecone database. This is a complete, one-step action.",
  inputSchema: z.object({
    text: z.string().describe("The user's raw feedback text."),
    userId: z.string().describe("The ID of the user this feedback belongs to."),
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  execute: async ({ context }) => {
    const { text, userId } = context;

    // --- Step 1: Embed the text (logic from embedTool is now here) ---
    console.log(`Embedding text for user ${userId}...`);
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: text,
    });

    // --- Step 2: Save to Pinecone (logic from pineconeTool is now here) ---
    console.log('Saving vector to Pinecone...');
    await pineconeIndex.upsert([{
      id: `feedback_${Date.now()}_${userId}`,
      values: embedding,
      metadata: {
        userId: userId,
        originalText: text,
      },
    }]);
    
    console.log('✅ Feedback saved successfully!');
    return { success: true };
  },
});