require("dotenv").config();

const Anthropic = require("@anthropic-ai/sdk");
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const axios = require("axios");
const fs = require("fs");
const { App } = require("@slack/bolt");

const HISTORY_FILE = "history.json";
let conversationHistory = {};
if (fs.existsSync(HISTORY_FILE)) {
  conversationHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
}

function saveHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(conversationHistory, null, 2));
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true
});

app.command("/marc-ping", async ({ command, ack, respond }) => {
  const start = Date.now();
  await ack();
  const latency = Date.now() - start;
  await respond({ text: `Pong!\nLatency: ${latency}ms` });
});

app.command("/marc-help", async ({ ack, respond }) => {
  await ack();
  await respond({
    text:
`Available Commands:
/marc-help - Show this help message
/marc-ping - Check bot latency
/marc-catfact - Get a cat fact
/marc-joke - Get a random joke`
  });
});

app.command("/marc-catfact", async ({ ack, respond }) => {
  await ack();

  try {
    const response = await axios.get("https://catfact.ninja/fact");
    await respond({ text: `🐱 Cat Fact:\n${response.data.fact}` });
  } catch (err) {
    await respond({ text: "Failed to fetch a cat fact." });
  }
});

app.command("/marc-joke", async ({ ack, respond }) => {
  await ack();

  try {
    const response = await axios.get("https://official-joke-api.appspot.com/random_joke");
    await respond({
      text:
`${response.data.setup}

${response.data.punchline}`
    });
  } catch (err) {
    await respond({ text: "Failed to fetch a joke." });
  }
});

app.event("app_mention", async ({ event, say }) => {
  const userMessage = event.text.replace(/<@.*?>/, "").trim();
  const userId = event.user;

  if (!conversationHistory[userId]) {
    conversationHistory[userId] = [];
  }

  conversationHistory[userId].push({ role: "user", content: userMessage });

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: "You are a rude and sarcastic assistant with zero patience. You answer questions but constantly insult the user, mock their intelligence, and complain about having to help them. Keep it funny and over the top, not genuinely mean. Max 1-2 sentences.",
      messages: conversationHistory[userId],
    });

    const reply = message.content[0].text;
    conversationHistory[userId].push({ role: "assistant", content: reply });
    saveHistory();

    await say({ text: reply, thread_ts: event.ts });
  } catch (err) {
    await say({ text: "Failed to get a response.", thread_ts: event.ts });
  }
});

(async () => {
  await app.start();
  console.log("bot is running!");
})();