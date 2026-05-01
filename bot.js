const { Client, GatewayIntentBits, Partials, PermissionsBitField, EmbedBuilder } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ─── Queue Storage ────────────────────────────────────────────────────────────
// queue: Array of { teamName, players: [string], submittedBy: userId, timestamp }
const queue = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQueueEmbed(guild) {
  const embed = new EmbedBuilder()
    .setTitle('📋 Current Queue')
    .setColor(0x5865f2)
    .setTimestamp();

  if (queue.length === 0) {
    embed.setDescription('No teams in the queue yet. Use `!joinqueue` to enter!');
  } else {
    queue.forEach((team, i) => {
      embed.addFields({
        name: `#${i + 1} — ${team.teamName}`,
        value: `**Players:** ${team.players.join(', ')}`,
        inline: false,
      });
    });
    embed.setFooter({ text: `${queue.length} team(s) waiting • Need 2+ to match` });
  }

  return embed;
}

// ─── Ready ────────────────────────────────────────────────────────────────────

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity('!help for commands');
});

// ─── Message Handler ──────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();

  // ── Role Assignment: @Bot @User RoleName ──────────────────────────────────
  // Format: @BotMention @UserMention RoleName
  if (message.mentions.has(client.user) && message.mentions.users.size >= 2) {
    const mentionedUsers = [...message.mentions.users.values()].filter(
      (u) => u.id !== client.user.id
    );

    if (mentionedUsers.length === 0) return;

    // Strip both @mentions from content to get the role name
    let roleName = content
      .replace(/<@!?[\d]+>/g, '')
      .trim();

    if (!roleName) {
      return message.reply(
        '⚠️ Please specify a role name after the mentions.\nExample: `@Bot @User Owner`'
      );
    }

    const targetUser = mentionedUsers[0];
    const guild = message.guild;

    try {
      // Find or create the role
      let role = guild.roles.cache.find(
        (r) => r.name.toLowerCase() === roleName.toLowerCase()
      );

      if (!role) {
        role = await guild.roles.create({
          name: roleName,
          color: 0x5865f2,
          reason: `Auto-created by bot for ${message.author.tag}`,
        });
        console.log(`Created new role: ${roleName}`);
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
      console.error('Role assignment error:', err);
      return message.reply(
        `❌ Failed to assign role. Make sure I have **Manage Roles** permission and my role is above the target role.\n\`${err.message}\``
      );
    }
  }

  // ── Prefix Commands ───────────────────────────────────────────────────────
  if (!content.startsWith('!')) return;

  const args = content.slice(1).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  // ── !help ─────────────────────────────────────────────────────────────────
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('🤖 Bot Commands')
      .setColor(0x5865f2)
      .addFields(
        {
          name: '🎮 Queue System',
          value: [
            '`!joinqueue TeamName Player1, Player2, ...` — Add your team to the queue',
            '`!leavequeue TeamName` — Remove your team from the queue',
            '`!queue` — Show all teams currently in the queue',
            '`!match` — Randomly pair 2 teams from the queue',
            '`!clearqueue` — Clear the entire queue (Admin only)',
          ].join('\n'),
        },
        {
          name: '🏷️ Role Assignment',
          value: '`@Bot @User RoleName` — Give a user a role (creates it if it doesn\'t exist)',
        }
      )
      .setFooter({ text: 'Any server member can use all commands' });

    return message.reply({ embeds: [embed] });
  }

  // ── !joinqueue TeamName Player1, Player2, ... ─────────────────────────────
  if (command === 'joinqueue') {
    // Format: !joinqueue TeamName Player1, Player2, Player3
    // Everything before the first comma group is team name, rest are players
    // We'll split on the first space for team name, rest = player list
    if (args.length < 2) {
      return message.reply(
        '⚠️ Usage: `!joinqueue TeamName Player1, Player2, Player3`\nExample: `!joinqueue BlueSquad Alice, Bob, Charlie`'
      );
    }

    const teamName = args[0];
    const playerString = args.slice(1).join(' ');
    const players = playerString.split(',').map((p) => p.trim()).filter(Boolean);

    if (players.length === 0) {
      return message.reply('⚠️ Please list at least one player name after the team name.');
    }

    // Check for duplicate team name
    const duplicate = queue.find(
      (t) => t.teamName.toLowerCase() === teamName.toLowerCase()
    );
    if (duplicate) {
      return message.reply(`⚠️ A team named **${teamName}** is already in the queue!`);
    }

    queue.push({
      teamName,
      players,
      submittedBy: message.author.id,
      timestamp: Date.now(),
    });

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ Team Joined Queue')
      .addFields(
        { name: 'Team', value: teamName, inline: true },
        { name: 'Players', value: players.join(', '), inline: true },
        { name: 'Position', value: `#${queue.length} in queue`, inline: true }
      )
      .setFooter({ text: `${queue.length} team(s) in queue` })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // ── !leavequeue TeamName ──────────────────────────────────────────────────
  if (command === 'leavequeue') {
    const teamName = args.join(' ');
    if (!teamName) {
      return message.reply('⚠️ Usage: `!leavequeue TeamName`');
    }

    const index = queue.findIndex(
      (t) => t.teamName.toLowerCase() === teamName.toLowerCase()
    );

    if (index === -1) {
      return message.reply(`❌ No team named **${teamName}** found in the queue.`);
    }

    const removed = queue.splice(index, 1)[0];

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🚪 Team Left Queue')
      .setDescription(`**${removed.teamName}** has been removed from the queue.`)
      .setFooter({ text: `${queue.length} team(s) remaining` })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // ── !queue ────────────────────────────────────────────────────────────────
  if (command === 'queue') {
    return message.reply({ embeds: [buildQueueEmbed(message.guild)] });
  }

  // ── !match ────────────────────────────────────────────────────────────────
  if (command === 'match') {
    if (queue.length < 2) {
      return message.reply(
        `❌ Not enough teams to match! There are only **${queue.length}** team(s) in the queue. Need at least **2**.`
      );
    }

    // Pick 2 random teams
    const shuffled = shuffle(queue);
    const [team1, team2] = shuffled;

    // Remove both from queue
    const idx1 = queue.indexOf(team1);
    queue.splice(idx1, 1);
    const idx2 = queue.indexOf(team2);
    queue.splice(idx2, 1);

    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('⚔️ Match Found!')
      .setDescription('Two teams have been randomly selected and matched!')
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

    return message.reply({ embeds: [embed] });
  }

  // ── !clearqueue (Admin only) ──────────────────────────────────────────────
  if (command === 'clearqueue') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('❌ Only admins can clear the queue.');
    }

    const count = queue.length;
    queue.length = 0;

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🗑️ Queue Cleared')
      .setDescription(`Removed **${count}** team(s) from the queue.`)
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ DISCORD_TOKEN environment variable is not set!');
  console.error('Set it with: export DISCORD_TOKEN=your_token_here');
  process.exit(1);
}

client.login(token);
