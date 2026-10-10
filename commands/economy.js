const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const db = require('../db');

const DAILY_REWARD = 100;
const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;
const XP_PER_COMMAND = 3;
const XP_PER_TRANSFER = 10;
const XP_PER_DEPOSIT = 5;
const XP_PER_WITHDRAW = 5;
const XP_PER_DAILY = 50;
const WEBSITE_URL = process.env.WEBSITE_URL || 'https://zentro-website-production.up.railway.app';

function ensureUser(userId) {
  db.prepare(`
    INSERT INTO users (user_id, balance, bank, last_daily) VALUES (?, 0, 0, 0)
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId);
}

function addBalance(userId, amount) {
  ensureUser(userId);
  db.prepare('UPDATE users SET balance = balance + ? WHERE user_id = ?').run(amount, userId);
}

function addXp(userId, guildId, amount) {
  if (!guildId || amount <= 0) return;
  db.prepare(`
    INSERT INTO xp (guild_id, user_id, xp) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = xp + ?
  `).run(guildId, userId, amount, amount);
}

function getUserRank(guildId, userId) {
  const row = db.prepare(`
    SELECT COUNT(*) + 1 AS rank FROM xp
    WHERE guild_id = ? AND xp > (SELECT COALESCE(xp, 0) FROM xp WHERE guild_id = ? AND user_id = ?)
  `).get(guildId, guildId, userId);
  return row ? row.rank : null;
}

function levelFromXp(xp) {
  let level = 1;
  let needed = 100;
  let remaining = xp;
  while (remaining >= needed) {
    remaining -= needed;
    level++;
    needed = Math.floor(needed * 1.5);
  }
  return { level, current: remaining, needed };
}

function syncBalanceToWebsite(user) {
  const secret = process.env.DISCORD_TRANSFER_SECRET;
  if (!secret || !user) return;
  fetch(WEBSITE_URL + '/api/discord/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, user_id: user.id, username: user.username, wallet: getUserBalance(user.id), bank: getUserBank(user.id) })
  }).catch(() => {});
}

function getUserBalance(userId) {
  const row = db.prepare('SELECT balance FROM users WHERE user_id = ?').get(userId);
  return row ? row.balance : 0;
}

function getUserBank(userId) {
  const row = db.prepare('SELECT bank FROM users WHERE user_id = ?').get(userId);
  return row ? row.bank : 0;
}

function syncTransferToWebsite(payload) {
  const secret = process.env.DISCORD_TRANSFER_SECRET;
  if (!secret) return;
  fetch(WEBSITE_URL + '/api/discord/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, secret })
  }).catch(() => {});
}

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('balance')
      .setDescription('عرض رصيد محفظتك'),
    async execute(interaction) {
      ensureUser(interaction.user.id);
      const row = db.prepare('SELECT balance FROM users WHERE user_id = ?').get(interaction.user.id);
      syncBalanceToWebsite(interaction.user);
      await interaction.reply(`<@${interaction.user.id}>، رصيد حسابك هو **${row.balance.toLocaleString()} ZC**. | 💰`);
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('bank')
      .setDescription('عرض رصيدك في البنك'),
    async execute(interaction) {
      ensureUser(interaction.user.id);
      const row = db.prepare('SELECT bank FROM users WHERE user_id = ?').get(interaction.user.id);
      syncBalanceToWebsite(interaction.user);
      await interaction.reply(`<@${interaction.user.id}>، رصيد البنك الخاص بك هو **${row.bank.toLocaleString()} ZC**. | 🏦`);
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('daily')
      .setDescription('استلام المكافأة اليومية'),
    async execute(interaction) {
      ensureUser(interaction.user.id);
      const row = db.prepare('SELECT last_daily FROM users WHERE user_id = ?').get(interaction.user.id);
      const now = Date.now();
      const elapsed = now - row.last_daily;
      if (elapsed < DAILY_COOLDOWN) {
        const remaining = DAILY_COOLDOWN - elapsed;
        const hours = Math.floor(remaining / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);
        return interaction.reply(`<@${interaction.user.id}>، استلمت المكافأة اليومية بالفعل. جرب تاني بعد **${hours} ساعة و ${minutes} دقيقة**. | ⏳`);
      }
      db.prepare('UPDATE users SET balance = balance + ?, last_daily = ? WHERE user_id = ?')
        .run(DAILY_REWARD, now, interaction.user.id);
      addXp(interaction.user.id, interaction.guildId, XP_PER_DAILY);
      syncBalanceToWebsite(interaction.user);
      await interaction.reply(`<@${interaction.user.id}>، تم إضافة **${DAILY_REWARD} ZC** إلى رصيدك بنجاح. | 💰`);
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('deposit')
      .setDescription('إيداع عملات في البنك')
      .addIntegerOption(opt => opt.setName('amount').setDescription('المبلغ').setRequired(true)),
    async execute(interaction) {
      const amount = interaction.options.getInteger('amount');
      if (amount <= 0) return interaction.reply(`<@${interaction.user.id}>، المبلغ يجب أن يكون أكبر من صفر. | ❌`);
      ensureUser(interaction.user.id);
      const row = db.prepare('SELECT balance FROM users WHERE user_id = ?').get(interaction.user.id);
      if (row.balance < amount) return interaction.reply(`<@${interaction.user.id}>، رصيد محفظتك غير كافٍ. | ❌`);
      db.prepare('UPDATE users SET balance = balance - ?, bank = bank + ? WHERE user_id = ?')
        .run(amount, amount, interaction.user.id);
      addXp(interaction.user.id, interaction.guildId, XP_PER_DEPOSIT);
      syncBalanceToWebsite(interaction.user);
      await interaction.reply(`<@${interaction.user.id}>، تم إيداع **${amount.toLocaleString()} ZC** في البنك بنجاح. | 🏦`);
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('withdraw')
      .setDescription('سحب عملات من البنك')
      .addIntegerOption(opt => opt.setName('amount').setDescription('المبلغ').setRequired(true)),
    async execute(interaction) {
      const amount = interaction.options.getInteger('amount');
      if (amount <= 0) return interaction.reply(`<@${interaction.user.id}>، المبلغ يجب أن يكون أكبر من صفر. | ❌`);
      ensureUser(interaction.user.id);
      const row = db.prepare('SELECT bank FROM users WHERE user_id = ?').get(interaction.user.id);
      if (row.bank < amount) return interaction.reply(`<@${interaction.user.id}>، رصيد البنك غير كافٍ. | ❌`);
      db.prepare('UPDATE users SET bank = bank - ?, balance = balance + ? WHERE user_id = ?')
        .run(amount, amount, interaction.user.id);
      addXp(interaction.user.id, interaction.guildId, XP_PER_WITHDRAW);
      syncBalanceToWebsite(interaction.user);
      await interaction.reply(`<@${interaction.user.id}>، تم سحب **${amount.toLocaleString()} ZC** إلى محفظتك بنجاح. | 💰`);
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('transfer')
      .setDescription('تحويل عملات لعضو آخر')
      .addUserOption(opt => opt.setName('user').setDescription('العضو المستلم').setRequired(true))
      .addIntegerOption(opt => opt.setName('amount').setDescription('المبلغ').setRequired(true)),
    async execute(interaction) {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      if (target.bot) return interaction.reply({ content: `<@${interaction.user.id}>، لا يمكن التحويل للبوتات. | ❌`, ephemeral: true });
      if (target.id === interaction.user.id) return interaction.reply({ content: `<@${interaction.user.id}>، لا يمكنك التحويل لنفسك. | ❌`, ephemeral: true });
      if (amount <= 0) return interaction.reply({ content: `<@${interaction.user.id}>، المبلغ يجب أن يكون أكبر من صفر. | ❌`, ephemeral: true });
      ensureUser(interaction.user.id);
      const sender = db.prepare('SELECT balance FROM users WHERE user_id = ?').get(interaction.user.id);
      if (sender.balance < amount) return interaction.reply({ content: `<@${interaction.user.id}>، رصيدك غير كافٍ. | ❌`, ephemeral: true });

      const confirmId = `transfer_confirm_${interaction.user.id}_${target.id}_${amount}`;
      const cancelId = `transfer_cancel_${interaction.user.id}`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setLabel('تأكيد التحويل').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(cancelId).setLabel('إلغاء').setStyle(ButtonStyle.Danger)
      );

      const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('💸 تأكيد التحويل')
        .setDescription(`<@${interaction.user.id}>، هل أنت متأكد من تحويل **${amount.toLocaleString()} ZC** إلى <@${target.id}>؟`);

      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

      const collector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === interaction.user.id && (i.customId === confirmId || i.customId === cancelId),
        time: 60000
      });

      collector.on('collect', async i => {
        if (i.customId === cancelId) {
          await i.update({ content: 'تم إلغاء التحويل. | ❌', embeds: [], components: [] });
          collector.stop('cancelled');
          return;
        }
        const fresh = db.prepare('SELECT balance FROM users WHERE user_id = ?').get(interaction.user.id);
        if (!fresh || fresh.balance < amount) {
          await i.update({ content: 'رصيدك غير كافٍ الآن. | ❌', embeds: [], components: [] });
          collector.stop('insufficient');
          return;
        }
        db.prepare('UPDATE users SET balance = balance - ? WHERE user_id = ?').run(amount, interaction.user.id);
        addBalance(target.id, amount);
        const createdAt = Date.now();
        db.prepare('INSERT INTO transactions (sender_id, receiver_id, amount, created_at) VALUES (?, ?, ?, ?)')
          .run(interaction.user.id, target.id, amount, createdAt);
        syncTransferToWebsite({
          sender_id: interaction.user.id,
          receiver_id: target.id,
          amount,
          created_at: createdAt,
          sender_name: interaction.user.username,
          receiver_name: target.username
        });
        syncBalanceToWebsite(interaction.user);
        syncBalanceToWebsite(target);
        addXp(interaction.user.id, interaction.guildId, XP_PER_TRANSFER);
        await i.update({ content: `<@${interaction.user.id}>، تم تحويل **${amount.toLocaleString()} ZC** إلى <@${target.id}> بنجاح. | 💸`, embeds: [], components: [] });
        collector.stop('done');
      });

      collector.on('end', async (collected, reason) => {
        if (reason === 'time') {
          await interaction.editReply({ content: 'انتهت مدة تأكيد التحويل. | ⏳', embeds: [], components: [] }).catch(() => {});
        }
      });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('عرض ترتيب أغنى 100 عضو في البوت'),
    async execute(interaction) {
      const rows = db.prepare('SELECT user_id, balance FROM users ORDER BY balance DESC LIMIT 100').all();
      const list = rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — **${r.balance.toLocaleString()} ZC**`).join('\n') || 'لا يوجد أعضاء بعد.';
      const rankRow = db.prepare(`
        SELECT COUNT(*) + 1 AS rank FROM users
        WHERE balance > (SELECT balance FROM users WHERE user_id = ?)
      `).get(interaction.user.id);
      const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('🏆 لوحة ترتيب الأغنى — Top 100')
        .setDescription(list)
        .setFooter({ text: `<@${interaction.user.id}>، ترتيبك هو #${rankRow.rank} في البوت ده. | 💰` });
      await interaction.reply({ embeds: [embed] });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('xp')
      .setDescription('عرض نقاط الخبرة والمستوى بتاعتك في السيرفر'),
    async execute(interaction) {
      const row = db.prepare('SELECT xp FROM xp WHERE guild_id = ? AND user_id = ?')
        .get(interaction.guildId, interaction.user.id);
      const xp = row ? row.xp : 0;
      const { level, current, needed } = levelFromXp(xp);
      const rank = getUserRank(interaction.guildId, interaction.user.id);
      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle(`📊 XP بتاعتك في ${interaction.guild.name}`)
        .setDescription(`<@${interaction.user.id}>، نقاط خبرتك هي **${xp.toLocaleString()} XP** ومستواك **${level}**.`)
        .addFields(
          { name: 'الترتيب', value: `#${rank}`, inline: true },
          { name: 'الـ Level الجاي', value: `ناقصك **${needed - current} XP**`, inline: true }
        );
      await interaction.reply({ embeds: [embed] });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('topxp')
      .setDescription('عرض أعلى 10 أعضاء في XP داخل السيرفر'),
    async execute(interaction) {
      const rows = db.prepare('SELECT user_id, xp FROM xp WHERE guild_id = ? ORDER BY xp DESC LIMIT 10')
        .all(interaction.guildId);
      const list = rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — **${r.xp.toLocaleString()} XP**`).join('\n') || 'لا يوجد أعضاء بعد.';
      const rank = getUserRank(interaction.guildId, interaction.user.id);
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`🏆 Top 10 XP — ${interaction.guild.name}`)
        .setDescription(list)
        .setFooter({ text: rank > 10 ? `<@${interaction.user.id}>، ترتيبك هو #${rank} في السيرفر ده. | 📊` : '' });
      await interaction.reply({ embeds: [embed] });
    }
  }
];