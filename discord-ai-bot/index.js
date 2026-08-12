import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } from 'discord.js';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  AI_PROVIDER,
  AI_API_KEY,
  AI_MODEL,
  AI_BASE_URL,
  SYSTEM_PROMPT,
  AI_CHANNEL_ID,
} = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !AI_API_KEY || !AI_BASE_URL) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

const aiChannelId = AI_CHANNEL_ID || null;

const ai = new OpenAI({
  apiKey: AI_API_KEY,
  baseURL: AI_BASE_URL,
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('ถาม AI คำถามใด ๆ')
    .addStringOption((option) =>
      option.setName('question').setDescription('คำถามที่ต้องการถาม').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('chat')
    .setDescription('สนทนากับ AI')
    .addStringOption((option) =>
      option.setName('message').setDescription('ข้อความที่ต้องการส่ง').setRequired(true)
    ),
];

const rest = new REST().setToken(DISCORD_TOKEN);

async function registerCommands() {
  try {
    console.log('Registering slash commands...');
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
        body: commands,
      });
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), {
        body: commands,
      });
    }
    console.log('Slash commands registered.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

async function askAI(messages) {
  try {
    const completion = await ai.chat.completions.create({
      model: AI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT || 'You are a helpful assistant.' },
        ...messages,
      ],
    });
    return completion.choices[0]?.message?.content || 'ไม่พบคำตอบ';
  } catch (error) {
    console.error('AI error:', error);
    return 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ AI';
  }
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, channel, user } = interaction;

  if (commandName === 'ask') {
    await interaction.deferReply();

    const question = options.getString('question');
    const response = await askAI([{ role: 'user', content: question }]);

    const embed = new EmbedBuilder()
      .setTitle('AI Answer')
      .setDescription(response.slice(0, 4096))
      .setColor(0x5865f2)
      .setFooter({ text: `Asked by ${user.tag}` });

    await interaction.editReply({ embeds: [embed] });
  }

  if (commandName === 'chat') {
    await interaction.deferReply();

    const message = options.getString('message');
    const response = await askAI([{ role: 'user', content: message }]);

    const embed = new EmbedBuilder()
      .setTitle('AI Chat')
      .setDescription(response.slice(0, 4096))
      .setColor(0x5865f2)
      .setFooter({ text: `Chat with ${user.tag}` });

    await interaction.editReply({ embeds: [embed] });
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (aiChannelId) {
    if (message.channelId !== aiChannelId) return;
  } else if (message.guild) {
    const mention = client.user ? client.user.id : null;
    if (!message.mentions.has(mention)) return;
  }

  const content = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!content) return;

  await message.channel.sendTyping();
  const response = await askAI([{ role: 'user', content }]);

  const embed = new EmbedBuilder()
    .setTitle('AI Reply')
    .setDescription(response.slice(0, 4096))
    .setColor(0x5865f2);

  await message.reply({ embeds: [embed] });
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user?.tag}`);
  registerCommands();
});

client.login(DISCORD_TOKEN);
