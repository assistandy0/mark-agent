import "dotenv/config";
import pkg from "@slack/bolt";
import Anthropic from "@anthropic-ai/sdk";
import { loadSpec, buildSystemPrompt } from "./spec.js";

const { App, ExpressReceiver } = pkg;

// ---------- Konfiguracija ----------
const AGENTS = [
  {
    name: "Mark",
    appId: process.env.SLACK_MARK_APP_ID,
    botToken: process.env.SLACK_MARK_BOT_TOKEN,
    signingSecret: process.env.SLACK_MARK_SIGNING_SECRET,
    path: "/slack/mark/events",
  },
];

const SPEC_PATH = process.env.AGENT_COMPANY_PATH ?? "./agent-company.md";
const MODEL = process.env.AI_MODEL ?? "claude-sonnet-5-5";
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS ?? 4000);
const THREAD_LIMIT = Number(process.env.THREAD_CONTEXT_LIMIT ?? 30);
const PORT = Number(process.env.PORT ?? 3000);

for (const a of AGENTS) {
  for (const k of ["botToken", "signingSecret"]) {
    if (!a[k]) {
      console.error(`Manjka nastavitev za agenta ${a.name}: ${k}`);
      process.exit(1);
    }
  }
}
if (!process.env.AI_PROVIDER_API_KEY) {
  console.error("Manjka AI_PROVIDER_API_KEY");
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.AI_PROVIDER_API_KEY });

// Spec se prebere ob vsaki nalogi → spremembe v agent-company.md veljajo takoj, brez restarta.
function systemPromptFor(agentName) {
  return buildSystemPrompt(loadSpec(SPEC_PATH), agentName);
}

// ---------- Pomožne funkcije ----------
async function threadHistory(client, channel, threadTs, botUserId) {
  const res = await client.conversations.replies({ channel, ts: threadTs, limit: THREAD_LIMIT });
  const msgs = (res.messages ?? []).filter((m) => m.text && !m.subtype);
  const out = [];
  for (const m of msgs) {
    const isBot = m.user === botUserId || m.bot_id;
    const text = (m.text ?? "").replace(new RegExp(`<@${botUserId}>`, "g"), "").trim();
    if (!text) continue;
    const prev = out[out.length - 1];
    const role = isBot ? "assistant" : "user";
    // Anthropic zahteva izmenjujoče se vloge → zaporedna sporočila iste vloge združimo
    if (prev && prev.role === role) prev.content += "\n\n" + text;
    else out.push({ role, content: text });
  }
  // prvo sporočilo mora biti od uporabnika
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function runAgent({ agent, client, event, botUserId, logger }) {
  const channel = event.channel;
  const threadTs = event.thread_ts ?? event.ts;

  // 1) takoj povej, da delamo (Slack zahteva hiter ack; Bolt to naredi sam, to je vidni signal)
  const working = await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: "V delu – berem nalogo in pripravljam odgovor.",
  });

  try {
    // 2) kontekst niti
    const messages = await threadHistory(client, channel, threadTs, botUserId);
    if (!messages.length) {
      messages.push({ role: "user", content: event.text.replace(new RegExp(`<@${botUserId}>`, "g"), "").trim() });
    }

    // 3) klic modela
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPromptFor(agent.name),
      messages,
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim() || "Blokirano – model ni vrnil besedila.";

    // 4) odgovor v isto nit; "V delu" sporočilo nadomestimo
    await client.chat.update({ channel, ts: working.ts, text: toSlackMrkdwn(text) });
    logger.info(`[${agent.name}] odgovor poslan v ${channel}/${threadTs} (${response.usage?.output_tokens} tok)`);
  } catch (err) {
    logger.error(err);
    await client.chat.update({
      channel,
      ts: working.ts,
      text: `Blokirano – tehnična napaka pri obdelavi.\nNapaka: ${err.message ?? err}`,
    });
  }
}

// Minimalna pretvorba Markdown → Slack mrkdwn
function toSlackMrkdwn(s) {
  return s
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^\s*[-*]\s+/gm, "• ");
}

// ---------- Zagon enega Bolt App-a na agenta ----------
import express from "express";
const root = express();
root.get("/health", (_req, res) => res.json({ ok: true, agents: AGENTS.map((a) => a.name) }));

for (const agent of AGENTS) {
  const receiver = new ExpressReceiver({
    signingSecret: agent.signingSecret, // podpis se preveri PRED obdelavo dogodka
    endpoints: agent.path,
    processBeforeResponse: false,
  });
  const app = new App({ token: agent.botToken, receiver });

  let botUserId = null;
  app.event("app_mention", async ({ event, client, logger }) => {
    botUserId ??= (await client.auth.test()).user_id;
    await runAgent({ agent, client, event, botUserId, logger });
  });
  app.event("message", async ({ event, client, logger }) => {
    if (event.channel_type !== "im" || event.subtype || event.bot_id) return;
    botUserId ??= (await client.auth.test()).user_id;
    await runAgent({ agent, client, event, botUserId, logger });
  });
  app.error(async (e) => console.error(`[${agent.name}]`, e));

  root.use(receiver.router);
  console.log(`Agent ${agent.name}: ${agent.path}`);
}

root.listen(PORT, () => console.log(`mark-agent posluša na :${PORT}`));
