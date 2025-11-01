import OpenAI from "openai";
import {
  RefactorStrategy,
  BaseRefactorInput,
  RefactorResult,
} from "./refactor-strategy";
import { openai } from "../config/openai-client";

/**
 * The Context class — the central component of the Strategy Pattern.
 * It delegates behavior to the current strategy instance.
 */
export class RefactorContext {
  private strategy: RefactorStrategy;

  constructor(strategy: RefactorStrategy) {
    this.strategy = strategy;
  }

  // Allow switching strategies at runtime
  setStrategy(strategy: RefactorStrategy) {
    this.strategy = strategy;
  }

  // Executes the chosen strategy
  async execute(input: BaseRefactorInput): Promise<RefactorResult> {
    const prompt = this.strategy.buildPrompt(input);

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a stateless Java refactoring expert.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.0,
      max_tokens: 4000,
    });

    const text = resp.choices?.[0]?.message?.content ?? "";
    console.log("🔍 Raw AI Response:", text);

    return this.strategy.parseResponse(text);
  }
}
