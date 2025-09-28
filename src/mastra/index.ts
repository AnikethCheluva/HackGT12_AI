import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { calendarAgent } from './agents/calendar-agent';
import { knowledgeAgent } from './agents/knowledge-agent';
import { knowledgeSessionWorkflow } from './workflows/knowledge-session-workflow';

export const mastra = new Mastra({
  workflows: { knowledgeSessionWorkflow },
  agents: { calendarAgent, knowledgeAgent },
  storage: new LibSQLStore({
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
