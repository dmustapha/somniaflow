// relay-executor.ts
// Per-agent-type execution logic for the relay coordinator.
// Fetches real data from external APIs and returns string results.
// No external SDK dependencies — uses native fetch throughout.

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL   = "claude-haiku-4-5-20251001";

// Agent type constants (matches PipelineRegistry.sol)
export const AGENT_TYPE_JSON_API   = 0;
export const AGENT_TYPE_LLM        = 1;
export const AGENT_TYPE_PARSE_WEB  = 2;
export const AGENT_TYPE_EXTERNAL   = 3;

/**
 * Execute a JSON_API step: fetch data from a URL and extract a value.
 * Input format: "url|jsonPath|decimals" (pipe-delimited, same as contract)
 * jsonPath uses dot notation: "price" or "data.0.price"
 */
export async function executeJsonApi(inputTemplate: string, prevResult: string): Promise<string> {
  const interpolated = inputTemplate.replace("{prevResult}", prevResult);
  const parts        = interpolated.split("|");
  const url          = parts[0]?.trim();
  const jsonPath     = parts[1]?.trim() ?? "";
  const decimals     = parseInt(parts[2]?.trim() ?? "0", 10);

  if (!url) throw new Error(`JSON_API: missing URL in template: ${inputTemplate}`);

  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`JSON_API: HTTP ${res.status} from ${url}`);

  const json = await res.json();

  // Extract value using dot-notation path (e.g. "price" or "data.0.price")
  let value: unknown = json;
  if (jsonPath) {
    for (const key of jsonPath.split(".")) {
      if (value == null) break;
      value = (value as Record<string, unknown>)[key];
    }
  }

  if (value == null) throw new Error(`JSON_API: path "${jsonPath}" not found in response`);

  // Apply decimals scaling: divide by 10^decimals
  const numVal = parseFloat(String(value));
  if (!isNaN(numVal) && decimals > 0) {
    return (numVal / Math.pow(10, decimals)).toFixed(2);
  }

  return String(value);
}

/**
 * Interpolate {prevResult} and dot-path {prevResult.field.subfield} in templates.
 * Supports JSON-structured prevResult for typed data extraction between pipeline steps.
 */
export function interpolateTemplate(template: string, prevResult: string): string {
  // First handle dot-path references like {prevResult.result.price}
  let result = template.replace(/\{prevResult\.([^}]+)\}/g, (_match, path: string) => {
    try {
      const parsed = JSON.parse(prevResult);
      let value: unknown = parsed;
      for (const key of path.split(".")) {
        if (value == null) return "";
        value = (value as Record<string, unknown>)[key];
      }
      return value != null ? String(value) : "";
    } catch {
      return ""; // prevResult isn't JSON — dot-path can't resolve
    }
  });
  // Then handle plain {prevResult}
  result = result.replace("{prevResult}", prevResult);
  return result;
}

/**
 * Execute an EXTERNAL agent step: call an HTTP endpoint and return structured result.
 * Input format: "EXTERNAL|endpoint_url|json_body"
 * The endpoint must conform to somniaflow-agent-v1 manifest.
 */
export async function executeExternalAgent(
  inputTemplate: string,
  prevResult: string,
): Promise<string> {
  const interpolated = interpolateTemplate(inputTemplate, prevResult);
  const parts = interpolated.split("|");

  // Format: EXTERNAL|url|jsonBody
  const marker = parts[0]?.trim();
  const url = parts[1]?.trim();
  const jsonBody = parts.slice(2).join("|").trim(); // rejoin in case body has pipes

  if (marker !== "EXTERNAL" || !url) {
    throw new Error(`EXTERNAL: invalid template format. Expected EXTERNAL|url|body, got: ${inputTemplate.substring(0, 80)}`);
  }

  let body: Record<string, unknown> = {};
  if (jsonBody) {
    try { body = JSON.parse(jsonBody); } catch { body = {}; }
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`EXTERNAL: HTTP ${res.status} from ${url}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();

  // If the response has a summary field, use it as the string result
  // Otherwise serialize the whole response
  if (data.summary) return data.summary;
  if (data.result) return typeof data.result === "string" ? data.result : JSON.stringify(data.result);
  return JSON.stringify(data);
}

/**
 * Execute an LLM_INFERENCE step: send a prompt to Claude and return the response.
 * The system prompt produces DECISION/REASONING/CONFIDENCE structured output.
 */
export async function executeLlmInference(
  inputTemplate: string,
  prevResult:    string,
  claudeApiKey:  string
): Promise<string> {
  if (!claudeApiKey) throw new Error("LLM: ANTHROPIC_API_KEY not set");

  const prompt = inputTemplate.replace("{prevResult}", prevResult);

  const body = {
    model:      CLAUDE_MODEL,
    max_tokens: 1024,
    system:     "You are a data processing agent. Analyze the input and respond with EXACTLY:\n" +
                "DECISION: EXECUTE\nor\nDECISION: SKIP\n" +
                "Then on separate lines:\n" +
                "REASONING: [2-3 sentences explaining your analysis]\n" +
                "CONFIDENCE: [HIGH|MEDIUM|LOW]\n" +
                "DECISION must appear on the first line.",
    messages: [
      { role: "user", content: prompt },
    ],
  };

  const res = await fetch(CLAUDE_API_URL, {
    method:  "POST",
    headers: {
      "x-api-key":         claudeApiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type":      "application/json",
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Claude API ${res.status}: ${err}`);
  }

  const data = await res.json();
  const content = data.content?.[0]?.text;
  if (!content) throw new Error("Claude: empty response");
  return content as string;
}

/**
 * Execute an LLM_PARSE_WEBSITE step: scrape a webpage and extract information via LLM.
 * Input format: "url|extractionPrompt|0" (pipe-delimited, same as contract)
 */
export async function executeLlmParseWebsite(
  inputTemplate: string,
  prevResult:    string,
  claudeApiKey:  string
): Promise<string> {
  const interpolated = inputTemplate.replace("{prevResult}", prevResult);
  const parts        = interpolated.split("|");
  const url              = parts[0]?.trim();
  const extractionPrompt = parts[1]?.trim() ?? "Extract the main content and key data from this page.";

  if (!url) throw new Error(`LLM_PARSE_WEBSITE: missing URL in template: ${inputTemplate}`);

  // Fetch the webpage
  const pageRes = await fetch(url, {
    signal:  AbortSignal.timeout(15_000),
    headers: { "User-Agent": "Mozilla/5.0 SomniaFlow/1.0" },
  });
  if (!pageRes.ok) throw new Error(`LLM_PARSE_WEBSITE: HTTP ${pageRes.status} from ${url}`);

  const html = await pageRes.text();

  // Strip HTML tags for LLM consumption
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .substring(0, 8000);

  return executeLlmInference(
    `${extractionPrompt}\n\nPage content:\n${text}`,
    "",
    claudeApiKey
  );
}
