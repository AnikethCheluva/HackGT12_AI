import { createWorkflow, createStep } from "@mastra/core/workflows";
import { knowledgeAgent } from "../agents/knowledge-agent";
import { z } from "zod";

const initializeAgent = createStep(knowledgeAgent);

export const knowledgeSessionWorkflow = createWorkflow({
  id: "knowledge-session-workflow",
  description: "Starts the knowledge agent and asks questions automatically.",
  inputSchema: z.object({}), // No input needed
  outputSchema: z.object({
    questions: z.string(),
  }),
}).map(async ({ }) => {
    return {
      prompt: `Ask questions:
1. What is your energy level at this moment?
2. How are you feeling right now?
3. How focused are you?`
    };
  })
  .then(initializeAgent)
  .commit();
