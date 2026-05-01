const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// ─── State ────────────────────────────────────────────────────────────────────

const queue = [];           // { teamName, players, submittedBy (userId), guildId }
let queueMessageId = null;  // The pinned live queue embed message ID
let queueChannelId = null;  // The channel the live embed lives in
let matchTimer = null;      // The 15s countdown timeout
let countdown = 0;          // Current seconds remaining
let countdownInterval = null;

const MATCH_DELAY_SECONDS = 15;
const WAITING_VC_NAME = 'Waiting for drag'; // Voice channel name to direct users to

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQueueEmbed(secondsLeft = null) {
  const embed = new EmbedBuilder()
    .setTitle('🏁  Race Queue')
    .setColor(queue.length >= 2 ? 0xfee75c : 0x5865f2)
    .setTimestamp();

  if (queue.length === 0) {
    embed.setDescription(
      '**No teams in queue.**\nType `!joinqueue TeamName Player1, Player2` to enter!'
    );
  } else {
    const teamLines = queue.map((t, i) =>
      `**#${i + 1} — ${t.teamName}**\n└ ${t.players.join(', ')}`
    );
    embed.setDescription(teamLines.join('\n\n'));
  }

  if (secondsLeft !== null && secondsLeft > 0 && queue.length >= 2) {
    embed.addFields({
      name: '⏳ Match starting in...',
      value: `**${secondsLeft}** seconds`,
    });
    embed.setColor(0xed4245);
  } else if (queue.length >= 2) {
    embed.addFields({
      name: '✅ Ready to match!',
      value: 'Starting countdown...',
    });
  }

  embed.setFooter({ text: `${queue.length} team(s) in queue` });
  return embed;
}

function buildQueueRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_queue')
      .setLabel('📋 View Queue')
      .setStyle(ButtonStyle.Secondary)
  );
}

async function updateQueueMessage(secondsLeft = null) {
  if (!queueChannelId || !queueMessageId) return;
  try {
    const channel = await client.channels.fetch(queueChannelId);
    const msg = await channel.messages.fetch(queueMessageId);
    await msg.edit({ embeds: [buildQueueEmbed(secondsLeft)], components: [] });
  } catch (e) {
    // Message may have been deleted — reset
    queueMessageId = null;
  }
}

async function postOrUpdateQueue(channel) {
  const embed = buildQueueEmbed();
  if (queueMessageId && queueChannelId === channel.id) {
    try {
      const msg = await channel.messages.fetch(queueMessageId);
      await msg.edit({ embeds: [embed], components: [] });
      return;
    } catch {
      queueMessageId = null;
    }
  }
  // Post a new one
  const msg = await channel.send({ embeds: [embed] });
  queueMessageId = msg.id;
  queueChannelId = channel.id;
  try { await msg.pin(); } catch {}
}

function clearMatchTimer() {
  if (matchTimer) { clearTimeout(matchTimer); matchTimer = null; }
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  countdown = 0;
}

async function startMatchCountdown(channel) {
  clearMatchTimer(); // reset any existing timer

  countdown = MATCH_DELAY_SECONDS;
  await updateQueueMessage(countdown);

  countdownInterval = setInterval(async () => {
    countdown--;
    await updateQueueMessage(countdown);
    if (countdown <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }, 1000);

  matchTimer = setTimeout(async () => {
    clearInterval(countdownInterval);
    countdownInterval = null;
    matchTimer = null;

    if (queue.length < 2) return; // someone left during countdown

    await runAutoMatch(channel);
  }, MATCH_DELAY_SECONDS * 1000);
}

async function runAutoMatch(channel) {
  // Pick 2 random teams
  const shuffled = shuffle([...queue]);
  const team1 = shuffled[0];
  const team2 = shuffled[1];

  // Remove them from queue
  [team1, team2].forEach((t) => {
    const idx = queue.findIndex((q) => q.teamName === t.teamName);
    if (idx !== -1) queue.splice(idx, 1);
  });

  // Build match embed
  const matchEmbed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('⚔️  Match Found!')
    .setDescription(
      `Two teams have been matched! Join the **"${WAITING_VC_NAME}"** voice channel now.`
    )
    .addFields(
      {
        name: '🔵 Team 1',
        value: `**${team1.teamName}**\n${team1.players.join(', ')}`,
        inline: true,
      },
      { name: '🆚', value: '\u200b', inline: true },
      {
        name: '🔴 Team 2',
        value: `**${team2.teamName}**\n${team2.players.join(', ')}`,
        inline: true,
      }
    )
    .setFooter({ text: `${queue.length} team(s) still in queue` })
    .setTimestamp();

  // Post match result in channel
  await channel.send({ embeds: [matchEmbed] });

  // DM both team submitters
  const dmEmbed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🏁  Match Found!')
    .setDescription(
      `A match has been found for your team!\nPlease join the **"${WAITING_VC_NAME}"** voice channel in the server.`
    )
    .setTimestamp();

  for (const team of [team1, team2]) {
    try {
      const user = await client.users.fetch(team.submittedBy);
      await user.send({ embeds: [dmEmbed] });
    } catch {
      // User may have DMs disabled — skip silently
    }
  }

  // Update the live queue embed
  await updateQueueMessage();

  // If 2+ teams still in queue, restart the countdown
  if (queue.length >= 2) {
    await startMatchCountdown(channel);
  }
}

// ─── Ready ────────────────────────────────────────────────────────────────────

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity('!joinqueue to enter the race queue');
});

// ─── Message Handler ──────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();

  // ── Role Assignment: @Bot @User RoleName ────────────────────────────────
  if (message.mentions.has(client.user) && message.mentions.users.size >= 2) {
    const mentionedUsers = [...message.mentions.users.values()].filter(
      (u) => u.id !== client.user.id
    );
    if (!mentionedUsers.length) return;

    const roleName = content.replace(/<@!?[\d]+>/g, '').trim();
    if (!roleName) {
      return message.reply(
        '⚠️ Please specify a role name.\nExample: `@Bot @User Owner`'
      );
    }

    const targetUser = mentionedUsers[0];
    const guild = message.guild;
    try {
      let role = guild.roles.cache.find(
        (r) => r.name.toLowerCase() === roleName.toLowerCase()
      );
      if (!role) {
        role = await guild.roles.create({
          name: roleName,
          color: 0x5865f2,
          reason: `Auto-created by bot`,
        });
      }
      const member = await guild.members.fetch(targetUser.id);
      await member.roles.add(role);

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('✅ Role Assigned')
        .setDescription(`**${targetUser.username}** has been given the **${role.name}** role.`)
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    } catch (err) {
      return message.reply(
        `❌ Failed to assign role. Make sure I have **Manage Roles** permission and my role is above the target role.\n\`${err.message}\``
      );
    }
  }

  if (!content.startsWith('!')) return;
  const args = content.slice(1).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  // ── !help ──────────────────────────────────────────────────────────────
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('🤖 Bot Commands')
      .setColor(0x5865f2)
      .addFields(
        {
          name: '🎮 Queue System',
          value: [
            '`!joinqueue TeamName Player1, Player2` — Join the queue',
            '`!leavequeue TeamName` — Leave the queue',
            '`!queue` — Show the live queue',
            '`!clearqueue` — Clear all teams (Admin only)',
          ].join('\n'),
        },
        {
          name: '⚙️ How it works',
          value: `When 2+ teams are in the queue, a **${MATCH_DELAY_SECONDS}-second** countdown starts. Two teams are randomly selected and matched. Both team submitters receive a **DM** with the match details and are told to join **"${WAITING_VC_NAME}"**.`,
        },
        {
          name: '🏷️ Role Assignment',
          value: '`@Bot @User RoleName` — Give a user a role',
        }
      );
    return message.reply({ embeds: [embed] });
  }

  // ── !joinqueue ─────────────────────────────────────────────────────────
  if (command === 'joinqueue') {
    if (args.length < 2) {
      return message.reply(
        '⚠️ Usage: `!joinqueue TeamName Player1, Player2`\nExample: `!joinqueue BlueSquad Alice, Bob`'
      );
    }

    const teamName = args[0];
    const playerString = args.slice(1).join(' ');
    const players = playerString.split(',').map((p) => p.trim()).filter(Boolean);

    if (!players.length) {
      return message.reply('⚠️ Please list at least one player name.');
    }

    if (queue.find((t) => t.teamName.toLowerCase() === teamName.toLowerCase())) {
      return message.reply(`⚠️ **${teamName}** is already in the queue!`);
    }

    queue.push({
      teamName,
      players,
      submittedBy: message.author.id,
      guildId: message.guild.id,
    });

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ Joined Queue')
      .addFields(
        { name: 'Team', value: teamName, inline: true },
        { name: 'Players', value: players.join(', '), inline: true },
        { name: 'Position', value: `#${queue.length} in queue`, inline: true }
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
    await postOrUpdateQueue(message.channel);

    // Start countdown if we now have 2+ teams
    if (queue.length >= 2 && !matchTimer) {
      await message.channel.send(
        `🕐 **${queue.length} teams in queue!** Match will start in **${MATCH_DELAY_SECONDS} seconds** unless more teams join...`
      );
      await startMatchCountdown(message.channel);
    }

    return;
  }

  // ── !leavequeue ────────────────────────────────────────────────────────
  if (command === 'leavequeue') {
    const teamName = args.join(' ');
    if (!teamName) return message.reply('⚠️ Usage: `!leavequeue TeamName`');

    const index = queue.findIndex(
      (t) => t.teamName.toLowerCase() === teamName.toLowerCase()
    );
    if (index === -1) {
      return message.reply(`❌ No team named **${teamName}** in the queue.`);
    }

    queue.splice(index, 1);

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🚪 Left Queue')
      .setDescription(`**${teamName}** has been removed.`)
      .setFooter({ text: `${queue.length} team(s) remaining` })
      .setTimestamp();

    await message.reply({ embeds: [embed] });

    // Cancel timer if we drop below 2
    if (queue.length < 2) {
      if (matchTimer) {
        clearMatchTimer();
        await message.channel.send('⚠️ Countdown cancelled — not enough teams.');
      }
    }

    await updateQueueMessage();
    return;
  }

  // ── !queue ─────────────────────────────────────────────────────────────
  if (command === 'queue') {
    await postOrUpdateQueue(message.channel);
    return;
  }

  // ── !clearqueue (Admin only) ───────────────────────────────────────────
  if (command === 'clearqueue') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('❌ Only admins can clear the queue.');
    }
    clearMatchTimer();
    const count = queue.length;
    queue.length = 0;

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🗑️ Queue Cleared')
      .setDescription(`Removed **${count}** team(s).`)
      .setTimestamp();

    await message.reply({ embeds: [embed] });
    await updateQueueMessage();
    return;
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN is not set!');
  process.exit(1);
}
client.login(token);
