require('dotenv').config();
const crypto = require('crypto');
const { Client, GatewayIntentBits } = require('discord.js');

const USERS = [
  { discordId: 'xxxxxxxx', iracingId: 123456 },
];

const SPORTS_CAR_CATEGORY_ID = 5;
const SYNC_INTERVAL = 60 * 60 * 1000;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const mask = (secret, id) =>
  crypto.createHash('sha256').update(secret + id.trim().toLowerCase()).digest('base64');

async function getToken() {
  const res = await fetch('https://oauth.iracing.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password_limited',
      client_id: process.env.IRACING_CLIENT_ID,
      client_secret: mask(process.env.IRACING_CLIENT_SECRET, process.env.IRACING_CLIENT_ID),
      username: process.env.IRACING_USERNAME,
      password: mask(process.env.IRACING_PASSWORD, process.env.IRACING_USERNAME),
      scope: 'iracing.auth',
    }),
  });
  if (!res.ok) throw new Error(`iRacing auth failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function iracingGet(path, token) {
  const res = await fetch(`https://members-ng.iracing.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`iRacing ${path}: ${res.status}`);
  const data = await res.json();
  if (data.link) {
    const linked = await fetch(data.link);
    if (!linked.ok) throw new Error(`iRacing link fetch: ${linked.status}`);
    return linked.json();
  }
  return data;
}

async function getSportsCarIRating(iracingId, token) {
  const data = await iracingGet(`/data/member/get?cust_ids=${iracingId}&include_licenses=true`, token);
  const member = data.members?.[0];
  if (!member) throw new Error(`No iRacing member ${iracingId}`);
  const license = member.licenses?.find(l => l.category_id === SPORTS_CAR_CATEGORY_ID);
  if (!license) throw new Error(`No sports car license for ${iracingId}`);
  return { name: member.display_name, irating: license.irating };
}

function buildNickname(name, irating) {
  const suffix = ` | ${irating}iR`;
  return name.slice(0, 32 - suffix.length) + suffix;
}

async function sync() {
  let token;
  try {
    token = await getToken();
  } catch (err) {
    console.error(err.message);
    return;
  }

  const guild = await client.guilds.fetch(process.env.GUILD_ID);

  for (const { discordId, iracingId } of USERS) {
    try {
      const { name, irating } = await getSportsCarIRating(iracingId, token);
      const member = await guild.members.fetch(discordId);
      const nickname = buildNickname(name, irating);
      if (member.nickname !== nickname) await member.setNickname(nickname);
      console.log(`${discordId} -> ${nickname}`);
    } catch (err) {
      console.error(`${discordId} (${iracingId}): ${err.message}`);
    }
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  sync();
  setInterval(sync, SYNC_INTERVAL);
});

client.login(process.env.DISCORD_TOKEN);