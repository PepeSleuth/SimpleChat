import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { messagesToModelMessages, createOpenRouterTools } from './messageUtils';

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
  reasoningEffort,
  webSearchEnabled,
  abortSignal,
  onText,
}) {
  const openrouter = createOpenRouter({ apiKey });
  const modelOptions = {
    usage: { include: true },
    ...(reasoningEffort ? { extraBody: { reasoning: { effort: reasoningEffort } } } : {}),
  };
  const modelMessages = await messagesToModelMessages(messages);
  const tools = webSearchEnabled ? createOpenRouterTools(openrouter) : undefined;
  const result = streamText({
    model: openrouter(model, modelOptions),
    messages: modelMessages,
    ...(tools ? { tools } : {}),
    abortSignal,
  });

  let text = '';
  for await (const chunk of result.textStream) {
    text += chunk;
    onText(text);
  }

  const usage = await result.usage;
  const providerMeta = await result.providerMetadata ?? await result.experimental_providerMetadata;
  const openRouterUsage = getOpenRouterUsage(providerMeta);

  return {
    text,
    stats: {
      date: new Date().toISOString(),
      model,
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
      totalTokens: usage?.totalTokens,
      webSearchRequests: openRouterUsage.webSearchRequests,
      cost: openRouterUsage.cost,
    },
  };
}
