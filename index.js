require("dotenv").config();

const Anthropic = require("@anthropic-ai/sdk");
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const OpenAI = require("openai");
const ai = new OpenAI({
  apiKey: process.env.HACKCLUB_API_KEY,
  baseURL: "https://ai.hackclub.com/proxy/v1",
});

const axios = require("axios");
const fs = require("fs");
const { App } = require("@slack/bolt");

const HISTORY_FILE = "history.json";
const BOT_FACTS_FILE = "botfacts.json";
const ADMIN_USER_ID = "U0A173QKK9R";

let userMemory = {};
if (fs.existsSync(HISTORY_FILE)) {
  userMemory = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
}

let botFacts = [];
if (fs.existsSync(BOT_FACTS_FILE)) {
  botFacts = JSON.parse(fs.readFileSync(BOT_FACTS_FILE, "utf8"));
}

function saveHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(userMemory, null, 2));
}

function saveBotFacts() {
  fs.writeFileSync(BOT_FACTS_FILE, JSON.stringify(botFacts, null, 2));
}

function getBotFacts() {
  return botFacts.length > 0 ? `\nThings you know as facts: ${botFacts.join(". ")}` : "";
}

async function updateMemory(userId, newMessages) {
  if (!userMemory[userId]) userMemory[userId] = { summary: "", messages: [] };

  userMemory[userId].messages.push(...newMessages);

  if (userMemory[userId].messages.length >= 5) {
    const summaryResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `Based on these messages, write a short bullet point summary of what you know about this user — their interests, preferences, personality, dislikes, and anything relevant. Keep it under 100 words. Current summary: "${userMemory[userId].summary}". New messages: ${JSON.stringify(userMemory[userId].messages)}`
      }]
    });

    userMemory[userId].summary = summaryResponse.content[0].text;
    userMemory[userId].messages = [];
    saveHistory();
  } else {
    saveHistory();
  }
}

function getSystemPrompt(userId, basePrompt) {
  const memory = userMemory[userId]?.summary
    ? `What you know about this user: ${userMemory[userId].summary}`
    : "";
  return `${basePrompt}${getBotFacts()} ${memory}`;
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
/marc-joke - Get a random joke
/marc-clear - Clear your conversation history
/marc-weather <city> - Get weather information for a city
/marc-clear-dm - Clear bot messages in this DM
/marc-teach <fact> - Teach the bot a new fact
/marc-forget - Show or remove taught facts`
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
      text: `${response.data.setup}\n\n${response.data.punchline}`
    });
  } catch (err) {
    await respond({ text: "Failed to fetch a joke." });
  }
});

app.command("/marc-clear", async ({ ack, respond, command }) => {
  await ack();
  const userId = command.user_id;
  userMemory[userId] = { summary: "", messages: [] };
  saveHistory();
  await respond({ text: "Your conversation history has been cleared!" });
});

app.command("/marc-weather", async ({ ack, respond, command }) => {
  await ack();
  const city = command.text.trim();

  if (!city) {
    await respond({ text: "Usage: /marc-weather <city>" });
    return;
  }

  try {
    const geoRes = await axios.get(`https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${process.env.OPENWEATHER_API_KEY}`);
    const location = geoRes.data[0];

    const weatherRes = await axios.get(`https://api.openweathermap.org/data/3.0/onecall?lat=${location.lat}&lon=${location.lon}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric&exclude=minutely,hourly,daily,alerts`);
    const weather = weatherRes.data.current;

    await respond({
      text: `Weather in ${location.name}, ${location.country}:\n🌡️ Temperature: ${weather.temp}°C\n🌤️ ${weather.weather[0].description}\n💨 Wind: ${weather.wind_speed} km/h`
    });
  } catch (err) {
    await respond({ text: "Couldn't find weather for that city." });
  }
});

app.command("/marc-teach", async ({ ack, respond, command }) => {
  await ack();

  if (command.user_id !== ADMIN_USER_ID) {
    await respond({ text: "nah you're not allowed to do that." });
    return;
  }

  const fact = command.text.trim();

  if (!fact) {
    await respond({ text: "Usage: /marc-teach <fact>" });
    return;
  }

  if (botFacts.length >= 20) {
    await respond({ text: "I'm full! Use /marc-forget to remove some facts first." });
    return;
  }

  botFacts.push(fact);
  saveBotFacts();
  await respond({ text: `Got it! I'll remember: "${fact}"` });
});

app.command("/marc-forget", async ({ ack, respond, command }) => {
  await ack();

  if (command.user_id !== ADMIN_USER_ID) {
    await respond({ text: "nah you're not allowed to do that." });
    return;
  }

  const input = command.text.trim();

  if (!input) {
    if (botFacts.length === 0) {
      await respond({ text: "No facts stored yet!" });
      return;
    }
    await respond({ text: `Current facts:\n${botFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")}` });
    return;
  }

  const index = parseInt(input) - 1;
  if (isNaN(index) || index < 0 || index >= botFacts.length) {
    await respond({ text: "Invalid number. Use /marc-forget to see the list." });
    return;
  }

  const removed = botFacts.splice(index, 1);
  saveBotFacts();
  await respond({ text: `Forgot: "${removed[0]}"` });
});

app.event("app_mention", async ({ event, say }) => {
  const userMessage = event.text.replace(/<@.*?>/, "").trim();
  const userId = event.user;

  try {
    const message = await ai.chat.completions.create({
      model: "anthropic/claude-opus-4-6",
      max_tokens: 1024,
      messages: [
        { role: "system", content: getSystemPrompt(userId, "you are marcellus. your tone is a direct reflection of the user's energy. if they're being cool, be helpful but stay blunt. if they're being a tool, be a bigger tool back. for actual facts or math, give the answer but act like it's a chore. use all lowercase, no markdown, and stay short like under 1-2 sentences unless it is really necessary. don't repeat yourself or use \"bot-like\" filler.") },
        { role: "user", content: userMessage }
      ],
    });

    const reply = message.choices[0].message.content;

    await updateMemory(userId, [
      { role: "user", content: userMessage },
      { role: "assistant", content: reply }
    ]);

    await say({ text: reply, thread_ts: event.ts });
  } catch (err) {
    console.error(err);
    await say({ text: "Failed to get a response.", thread_ts: event.ts });
  }
});

app.message(async ({ message, say }) => {
  if (message.subtype || message.channel_type !== 'im') return;

  const userId = message.user;
  const userMessage = message.text;

  if (!userMessage) return;

  try {
    const response = await ai.chat.completions.create({
      model: "anthropic/claude-opus-4-6",
      max_tokens: 1024,
      messages: [
        { role: "system", content: getSystemPrompt(userId, "you are marcellus. your tone is a direct reflection of the user's energy. if they're being cool, be helpful but stay blunt. if they're being a tool, be a bigger tool back. for actual facts or math, give the answer but act like it's a chore. use all lowercase, no markdown, and stay short. don't repeat yourself or use \"bot-like\" filler.") },
        { role: "user", content: userMessage }
      ],
    });

    const reply = response.choices[0].message.content;

    await updateMemory(userId, [
      { role: "user", content: userMessage },
      { role: "assistant", content: reply }
    ]);

    await say({ text: reply });
  } catch (err) {
    console.error(err);
    await say({ text: "Failed to get a response." });
  }
});

app.command("/marc-clear-dm", async ({ ack, respond, command, client }) => {
  await ack();

  try {
    const history = await client.conversations.history({
      channel: command.channel_id,
      limit: 100
    });

    const botMessages = history.messages.filter(m => m.bot_id);

    for (const msg of botMessages) {
      try {
        await client.chat.delete({
          channel: command.channel_id,
          ts: msg.ts
        });
      } catch (e) { }
    }

    await respond({ text: "Cleared!" });
  } catch (err) {
    await respond({ text: "Couldn't clear messages." });
  }
});

(async () => {
  await app.start();
  console.log("bot is running!");
})();