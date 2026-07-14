/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AssistantAction } from '../../../context_provider/public';
import { HumanInputService, AskUserOption } from './human_input_service';
import { InlineAskUser } from '../components/ask_user_card';

interface AskUserArgs {
  prompt: string;
  inputType?: 'select' | 'confirm' | 'text';
  options?: Array<string | AskUserOption>;
  allowFreeText?: boolean;
}

/**
 * Build the `ask_user` frontend-tool definition. The handler blocks on
 * {@link HumanInputService.ask} until the user answers; the run pauses at the
 * tool-use boundary and resumes with a continuation run carrying the answer.
 *
 * A plain factory (not a React hook) so it can be registered imperatively at
 * plugin `start()` — before any conversation replay. This avoids a race where
 * replay's `hasAction('ask_user')` check (`injectUnfinishedToolCallEvents`)
 * could run before a React effect registered the action, dropping a pending
 * question on reload.
 */
export const createAskUserAction = (
  humanInputService: HumanInputService
): AssistantAction<AskUserArgs> => ({
  name: 'ask_user',
  description:
    'Ask the user a structured question and wait for their answer before continuing. ' +
    'Use this to resolve ambiguity, let the user choose between options, or confirm an ' +
    'action before proceeding — instead of guessing or asking in free-form text. ' +
    "Set inputType to 'select' with options for a multiple-choice question, 'confirm' for " +
    "a yes/no decision, or 'text' for free-form input. For a 'select' question, set " +
    'allowFreeText: true to also offer a text field so the user can answer with something ' +
    'not in the options. ' +
    'If a result comes back with declined: true, the user chose not to answer that ' +
    'question (identified by the echoed question field) — do NOT ask it again, in a card ' +
    'or in free-form text. Acknowledge briefly and proceed with a sensible default or ' +
    'continue without that detail.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The question to show the user.',
      },
      inputType: {
        type: 'string',
        enum: ['select', 'confirm', 'text'],
        description: "How the user should answer. Defaults to 'text'.",
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: "Choices for a 'select' question.",
      },
      allowFreeText: {
        type: 'boolean',
        description:
          "For a 'select' question, also show a free-text field so the user can answer with " +
          'something not listed in options. Ignored for other input types.',
      },
    },
    required: ['prompt'],
  },
  // Render the question inline at the tool-call position (replacing the generic
  // "Running" spinner). See InlineAskUser for the pending/resolved handling.
  useCustomRenderer: true,
  // The assistant text introduces the question, so the card follows it rather than
  // leading the turn.
  renderPlacement: 'below',
  render: ({ args, result, toolCallId }) => {
    const prompt = args && typeof args === 'object' ? (args as AskUserArgs).prompt : undefined;
    const answer =
      result && typeof result === 'object' && typeof (result as any).answer === 'string'
        ? (result as any).answer
        : undefined;
    return (
      <InlineAskUser
        humanInputService={humanInputService}
        toolCallId={toolCallId}
        prompt={prompt}
        answer={answer}
      />
    );
  },
  handler: async (args, toolCallId) => {
    const id = toolCallId ?? `ask_user-${Date.now()}`;

    // Normalize options: accept bare strings or {label, value}.
    const options: AskUserOption[] | undefined = args.options?.map((opt) =>
      typeof opt === 'string' ? { label: opt, value: opt } : opt
    );

    const response = await humanInputService.ask({
      toolCallId: id,
      prompt: args.prompt,
      inputType: args.inputType,
      options,
      allowFreeText: args.allowFreeText,
    });

    // Torn down (conversation reset) — signal cancellation so the executor
    // skips dispatching a result. See tryExecuteRegisteredAction.
    if (response.cancelled) {
      return { cancelled: true };
    }
    // Explicit "skip" — a real answer the assistant should see.
    if (response.declined) {
      return { answered: false, declined: true };
    }
    return { answered: true, answer: response.answer };
  },
});
