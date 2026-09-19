import { requestError, retryRequest } from './requestRetry';
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

export async function streamOpenRouterChat(options) {
  return retryRequest(() => {
    options.onText('');
    options.onReasoningText?.('');
    options.onToolCalls?.([]);
    return streamAttempt(options);
  }, { signal: options.abortSignal, onStatus: options.onStatus });
}

async function streamAttempt({
  apiKey,
  model,
  messages,
  conversationId,
  reasoningEffort,
  webSearchEnabled,
  abortSignal,
  onText,
  onReasoningText,
  onToolCalls,
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
  let streamError;
  const result = streamText({
    model: openrouter(model, modelOptions),
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(6),
    prepareStep: ({ stepNumber }) => stepNumber === 5 ? { toolChoice: 'none' } : {},
    abortSignal,
    maxRetries: 0,
    timeout: { chunkMs: 90000 },
    onError: ({ error }) => { streamError = error; },
  });

  let text = '';
  let reasoningText = '';
  const toolCalls = new Map();
  try {
    for await (const chunk of result.fullStream) {
      if (chunk.type === 'text-delta') {
        text += chunk.text;
        onText(text);
      } else if (chunk.type === 'reasoning-delta') {
        reasoningText += chunk.text;
        onReasoningText?.(reasoningText);
      } else if (['tool-call', 'tool-result', 'tool-error'].includes(chunk.type)) {
        const previous = toolCalls.get(chunk.toolCallId);
        toolCalls.set(chunk.toolCallId, {
          ...previous,
          id: chunk.toolCallId,
          name: chunk.toolName,
          input: chunk.input ?? previous?.input,
          status: chunk.type === 'tool-error' || chunk.invalid ? 'error'
            : chunk.type === 'tool-result' && !chunk.preliminary ? 'complete' : 'running',
          ...(chunk.type === 'tool-result' ? { output: chunk.output } : {}),
          ...(chunk.error != null ? { error: chunk.error instanceof Error ? chunk.error.message : String(chunk.error) } : {}),
        });
        onToolCalls?.([...toolCalls.values()]);
      } else if (chunk.type === 'error') {
        throw requestError(chunk.error);
      }
    }

    abortSignal?.throwIfAborted();
    if (streamError) throw streamError;
    const finishReason = await result.finishReason;
    if (finishReason === 'error' || finishReason === 'unknown' || !text.trim()) {
      throw new Error('The response stream ended incomplete.');
    }
  } catch (cause) {
    const error = requestError(cause);
    if (text || reasoningText || toolCalls.size) {
      error.partialResponse = {
        text,
        stats: { date: new Date().toISOString(), model, reasoningEffort,
          reasoningText, toolCalls: [...toolCalls.values()], error: error.message },
      };
    }
    throw error;
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
      toolCalls: [...toolCalls.values()],
      promptTokens: usage?.inputTokens,
      completionTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
      webSearchRequests: sumUsage('webSearchRequests'),
      cost: sumUsage('cost'),
    },
  };
}
