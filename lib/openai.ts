export type OpenAIConfig = {
  apiKey: string;
  model: string;
};

type StructuredTicket = {
  title: string;
  summary: string;
  severity: "low" | "medium" | "high" | "critical";
  docCoverage: "missing" | "partial" | "adequate" | "unknown";
  affectedItems?: string[];
  reasoning?: string;
  tags?: string[];
};

type CreateTicketInput = OpenAIConfig & {
  input: string;
  channel: string;
};

const ticketSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
    docCoverage: { type: "string", enum: ["missing", "partial", "adequate", "unknown"] },
    affectedItems: { type: "array", items: { type: "string" } },
    reasoning: { type: "string" },
    tags: { type: "array", items: { type: "string" } }
  },
  required: ["title", "summary", "severity", "docCoverage"]
};

export const createStructuredTicketWithOpenAI = async (
  params: CreateTicketInput,
): Promise<StructuredTicket | null> => {
  const { apiKey, model, input, channel } = params;
  const systemPrompt =
    "You are a documentation triage assistant. Produce a compact ticket summary from Discord messages.";
  const userPrompt =
    `Channel: ${channel}\n\n${input}\n\n` +
    "Return a structured ticket with severity and documentation coverage. Use affectedItems only for concrete URLs or components.";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "discord_ticket",
          strict: true,
          schema: ticketSchema,
        },
      },
      temperature: 0.2,
      max_tokens: 600,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") return null;

  try {
    return JSON.parse(content) as StructuredTicket;
  } catch {
    return null;
  }
};
