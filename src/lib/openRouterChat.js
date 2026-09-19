import { streamText, stepCountIs } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { messagesToModelMessages, createOpenRouterTools } from './messageUtils';
import { createConversationTools, historyInstructions } from './conversationTools';

function getOpenRouterUsage(providerMeta) {
  const usage = providerMeta?.openrouter?.usage;
  return {
    cost: usage?.cost ?? null,
    webSearchRequests: usage?.server_tool_use?.web_search_requests ?? null,
  };
}

export async function streamOpenRouterChat({
  apiKey,
  model,
  messages,
  conversationId,
  reasoningEffort,
  webSearchEnabled,
  abortSignal,
  onText,
  onReasoningText,
}) {
  const openrouter = createOpenRouter({ apiKey });
  const modelOptions = {
    usage: { include: true },
    ...(reasoningEffort ? { extraBody: { reasoning: { effort: reasoningEffort } } } : {}),
  };
  const modelMessages = await messagesToModelMessages(messages);
  modelMessages.unshift({ role: 'system', content: historyInstructions });
  const tools = {
    ...createConversationTools(conversationId),
    ...(webSearchEnabled ? createOpenRouterTools(openrouter) : {}),
  };
  const result = streamText({
    model: openrouter(model, modelOptions),
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(6),
    prepareStep: ({ stepNumber }) => stepNumber === 5 ? { toolChoice: 'none' } : {},
    abortSignal,
  });

  let text = '';
  let reasoningText = '';
  for await (const chunk of result.fullStream) {
    if (chunk.type === 'text-delta') {
      text += chunk.text;
      onText(text);
    } else if (chunk.type === 'reasoning-delta') {
      reasoningText += chunk.text;
      onReasoningText?.(reasoningText);
    } else if (chunk.type === 'error') {
      throw chunk.error;
    }
  }

  const usage = await result.totalUsage;
  const stepUsage = (await result.steps).map(step => getOpenRouterUsage(step.providerMetadata));
  const sumUsage = key => {
    const values = stepUsage.map(usage => usage[key]).filter(value => value != null);
    return values.length ? values.reduce((sum, value) => sum + Number(value), 0) : null;
  };
  const reasoningTokens = usage?.outputTokenDetails?.reasoningTokens ?? usage?.reasoningTokens ?? null;

  return {
    text,
    stats: {
      date: new Date().toISOString(),
      model,
      reasoningEffort: reasoningEffort ?? null,
      reasoningTokens,
      reasoningText: reasoningText || null,
      promptTokens: usage?.inputTokens,
      completionTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
      webSearchRequests: sumUsage('webSearchRequests'),
      cost: sumUsage('cost'),
    },
  };
}
