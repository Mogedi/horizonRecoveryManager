// Hermes Discord bot — the agent loop.
// Slash commands (no Message Content intent needed):
//   /queue                  list active deals (read-only)
//   /case   deal:<id>       show a case summary (read-only)
//   /triage deal:<id>       propose a triage analysis (DRY RUN) → "Apply" button writes it
// Writes go through the audited/idempotent/kill-switchable HorizonManager API (hm-api).
import {
  Client, GatewayIntentBits, Partials, Events, MessageFlags,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder,
} from 'discord.js'
import { listQueue, getCase } from './cases-read.js'
import { triage } from './triage.js'
import { newWorkflow } from './hm-api.js'
import { chat } from './chat.js'
import { startSchedules, runAllSyncs, postDigestNow } from './schedules.js'
import { skillStatus, setSkillEnabled, getSkill } from './skills/registry.js'

const TOKEN = process.env.DISCORD_BOT_TOKEN
if (!TOKEN) { console.error('DISCORD_BOT_TOKEN not set'); process.exit(1) }
// Optional: restrict who may click "Apply". If unset, only the user who ran /triage can apply.
const OWNER_ID = process.env.DISCORD_OWNER_ID || null
// Optional: comma-separated channel IDs Hermes chats in. If unset, it replies in every channel it sees.
const CHAT_CHANNELS = (process.env.HERMES_CHAT_CHANNELS || '').split(',').map((s) => s.trim()).filter(Boolean)

const commands = [
  new SlashCommandBuilder().setName('queue').setDescription('List active deals (read-only)'),
  new SlashCommandBuilder().setName('case').setDescription('Show a case summary (read-only)')
    .addStringOption(o => o.setName('deal').setDescription('HubSpot deal ID').setRequired(true)),
  new SlashCommandBuilder().setName('triage')
    .setDescription('Propose a triage analysis (dry-run; Apply to write)')
    .addStringOption(o => o.setName('deal').setDescription('HubSpot deal ID').setRequired(true)),
  new SlashCommandBuilder().setName('sync-all')
    .setDescription('Run all scheduled syncs now, back-to-back (JustCall, Gmail, Drive, new-case Layer 2)'),
  new SlashCommandBuilder().setName('digest')
    .setDescription('Generate the morning briefing now and post it to the schedule channel'),
  new SlashCommandBuilder().setName('skills')
    .setDescription('List Hermes skills and whether each is on or off'),
  new SlashCommandBuilder().setName('skill').setDescription('Turn a Hermes skill on or off')
    .addSubcommand(sc => sc.setName('enable').setDescription('Turn a skill on')
      .addStringOption(o => o.setName('name').setDescription('skill name (see /skills)').setRequired(true)))
    .addSubcommand(sc => sc.setName('disable').setDescription('Turn a skill off')
      .addStringOption(o => o.setName('name').setDescription('skill name (see /skills)').setRequired(true))),
]

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent, // privileged — must be enabled in the Discord Developer Portal
  ],
  partials: [Partials.Channel], // required to receive DM events
})

// Proposed-but-unwritten analyses, keyed by a short token embedded in the Apply button.
const pending = new Map()
function remember(entry) {
  const id = Math.random().toString(36).slice(2, 10)
  pending.set(id, entry)
  if (pending.size > 200) pending.delete(pending.keys().next().value) // cap memory
  return id
}

const field = (name, value, inline = false) => ({ name, value: value && String(value).slice(0, 1024) || '—', inline })

client.once(Events.ClientReady, async (c) => {
  console.log(`hermes bot online as ${c.user.tag} — ${c.guilds.cache.size} guild(s)`)
  for (const guild of c.guilds.cache.values()) {
    try { await guild.commands.set(commands); console.log(`commands registered in "${guild.name}"`) }
    catch (e) { console.error(`command register failed in ${guild.id}: ${e.message}`) }
  }
  startSchedules(c)
})
client.on(Events.GuildCreate, async (g) => {
  try { await g.commands.set(commands); console.log(`commands registered in new guild "${g.name}"`) }
  catch (e) { console.error(`register failed: ${e.message}`) }
})

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'queue') {
        await interaction.deferReply()
        const rows = await listQueue(25)
        const body = rows.map(r => `\`${r.hubspot_id}\` — ${r.name ?? ''}`).join('\n').slice(0, 3800)
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('Active deals').setDescription(body || 'none')] })

      } else if (interaction.commandName === 'case') {
        await interaction.deferReply()
        const dealId = interaction.options.getString('deal', true)
        const c = await getCase(dealId)
        const a = c.latestAnalysis
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(c.deal.name ?? dealId).addFields(
          field('Stage', c.deal.stage, true),
          field('Contacts', String(c.contacts.length), true),
          field('Recent events', String(c.activity.length), true),
          field('Latest analysis', a ? `${a.health} / ${a.priority} — ${a.status_label ?? ''}` : 'none'),
        )] })

      } else if (interaction.commandName === 'triage') {
        await interaction.deferReply()
        const dealId = interaction.options.getString('deal', true)
        const result = await triage(dealId)
        if (result.skipped) { await interaction.editReply(`⏭️ SKIP \`${dealId}\`: ${result.reason}`); return }
        const a = result.analysis
        const id = remember({ dealId, analysis: a, inputHash: result.inputHash, userId: interaction.user.id })
        const embed = new EmbedBuilder().setTitle(`Triage proposal — ${dealId}`)
          .setDescription([a.statusLabel, a.reasoning].filter(Boolean).join('\n\n').slice(0, 4000))
          .addFields(
            field('Health', a.health, true),
            field('Priority', a.priority, true),
            field('Mo action?', a.moActionRequired ? 'yes' : 'no', true),
            field('Blockers', a.blockers.slice(0, 4).map(b => '• ' + b).join('\n')),
            field('Next action', a.nextAction),
          ).setFooter({ text: 'Dry-run — nothing written yet' })
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`apply:${id}`).setLabel('Apply (write)').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`cancel:${id}`).setLabel('Discard').setStyle(ButtonStyle.Secondary),
        )
        await interaction.editReply({ embeds: [embed], components: [row] })
      } else if (interaction.commandName === 'sync-all') {
        await interaction.deferReply()
        await interaction.editReply('🔄 Running all syncs (JustCall → Gmail → Drive → new-case Layer 2)…')
        const results = await runAllSyncs()
        const lines = results.map((r) => {
          const detail = r.ok ? (typeof r.detail === 'object' ? JSON.stringify(r.detail).slice(0, 180) : String(r.detail)) : r.detail
          return `${r.ok ? '✅' : '❌'} **${r.name}** — ${detail}`
        })
        await interaction.editReply('**Sync complete:**\n' + lines.join('\n'))

      } else if (interaction.commandName === 'digest') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })
        const text = await postDigestNow(client)
        await interaction.editReply(
          text ? '☀️ Posted the morning briefing to the schedule channel.'
               : '⚠️ Briefing generated empty, or the schedule channel did not resolve (check HERMES_SCHEDULE_CHANNEL).'
        )

      } else if (interaction.commandName === 'skills') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })
        const list = await skillStatus()
        const body = list.map(s =>
          `${s.enabled ? '🟢' : '⚪'} **${s.name}**${s.writes ? ' ✍️' : ''} — ${s.description}`
        ).join('\n')
        await interaction.editReply({ embeds: [new EmbedBuilder()
          .setTitle('Hermes skills').setDescription(body.slice(0, 4000))
          .setFooter({ text: '🟢 on · ⚪ off · ✍️ can write. Toggle with /skill enable|disable.' })] })

      } else if (interaction.commandName === 'skill') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })
        const sub = interaction.options.getSubcommand()
        const name = interaction.options.getString('name', true)
        if (!getSkill(name)) {
          await interaction.editReply(`Unknown skill \`${name}\`. Run /skills to see names.`); return
        }
        await setSkillEnabled(name, sub === 'enable')
        await interaction.editReply(`${sub === 'enable' ? '🟢 Enabled' : '⚪ Disabled'} **${name}**.`)
      }

    } else if (interaction.isButton()) {
      const [action, id] = interaction.customId.split(':')
      const entry = pending.get(id)
      if (!entry) { await interaction.reply({ content: 'This proposal has expired.', flags: MessageFlags.Ephemeral }); return }
      const allowed = OWNER_ID ? interaction.user.id === OWNER_ID : interaction.user.id === entry.userId
      if (!allowed) { await interaction.reply({ content: 'Only the requester can act on this.', flags: MessageFlags.Ephemeral }); return }

      if (action === 'cancel') {
        pending.delete(id)
        await interaction.update({ content: '🗑️ Discarded.', embeds: interaction.message.embeds, components: [] })
      } else if (action === 'apply') {
        await interaction.deferUpdate()
        const wf = newWorkflow()
        const idem = `hermes:triage:${entry.dealId}:${entry.inputHash.slice(0, 12)}`
        const written = await wf.postAnalysis(entry.dealId, {
          ...entry.analysis, analysisType: 'triage', generatedFrom: 'hermes-discord',
          inputHash: entry.inputHash, provider: 'anthropic', model: 'claude-sonnet-4-6',
        }, idem)
        pending.delete(id)
        await interaction.editReply({ content: `✅ Written — analysis id=${written.id} for \`${entry.dealId}\``, components: [] })
      }
    }
  } catch (e) {
    console.error('interaction error:', e)
    const msg = `⚠️ Error: ${e.message}`
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content: msg, components: [] })
      else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral })
    } catch { /* interaction may be gone */ }
  }
})

// Free-text chat — replies to every human message (Message Content intent is enabled). DMs always
// work; in guild channels, an optional HERMES_CHAT_CHANNELS allowlist can scope where it talks.
// Structured actions stay on the slash commands.
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return
    const isDM = !message.guildId
    if (!isDM && CHAT_CHANNELS.length) {
      const chName = message.channel?.name
      const allowed = CHAT_CHANNELS.includes(message.channelId) || (chName && CHAT_CHANNELS.includes(chName))
      if (!allowed) return
    }
    const text = (message.content ?? '').replace(/<@!?\d+>/g, '').trim()
    if (!text) return
    await message.channel.sendTyping().catch(() => {})
    const { text: answer, model, costUSD, searches } = await chat(message.channelId, text)
    const searchTag = searches ? ` · 🔎 ${searches}` : ''
    const footer = `\n-# 🪙 ${model.replace('claude-', '')} · ~$${costUSD.toFixed(4)}${searchTag}`
    const chunks = answer.match(/[\s\S]{1,1900}/g) ?? ['(no response)']
    chunks[chunks.length - 1] += footer
    await message.reply(chunks[0])
    for (const c of chunks.slice(1)) await message.channel.send(c)
  } catch (e) {
    console.error('message error:', e)
    try { await message.reply(`⚠️ ${e.message}`) } catch { /* interaction gone */ }
  }
})

client.login(TOKEN)
