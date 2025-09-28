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
    userId: z.string().describe("The ID of the user this feedback belongs to.")
  }),
  outputSchema: z.object({
    success: z.boolean()
  }),
  execute: async ({ context }) => {
    const { text, userId } = context;
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
        originalText: text
      }
    }]);
    console.log("\u2705 Feedback saved successfully!");
    return { success: true };
  }
});

export { embedFeedbackTool };
