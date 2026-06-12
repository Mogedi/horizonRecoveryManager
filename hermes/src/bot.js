// Hermes Discord bot — the agent loop.
// Slash commands (no Message Content intent needed):
//   /queue                  list active deals (read-only)
//   /case   deal:<id>       show a case summary (read-only)
//   /triage deal:<id>       propose a triage analysis (DRY RUN) → "Apply" button writes it
// Writes go through the audited/idempotent/kill-switchable HorizonManager API (hm-api).
import {
  Client, GatewayIntentBits, Partials, Events, MessageFlags,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js'
import { listQueue, getCase, getEmailThread } from './cases-read.js'
import { triage } from './triage.js'
import { newWorkflow, emailDraftCreate, emailDraftSend, emailDraftDiscard } from './hm-api.js'
import { chat, reviseDraft, summarizeThread } from './chat.js'
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

// ── Draft review cards ──────────────────────────────────────────────────────────
// Active draft state, keyed by a short token. Also indexed by the card's message id so a
// reply-to-the-card can be interpreted as a talk-to-edit instruction.
const drafts = new Map()          // token -> { draftId, replyToEmailId, to, cc, bcc, subject, body, channelId, userId, cardMessageId }
const draftByMessage = new Map()  // cardMessageId -> token  (reply-to-card = edit)
const draftByThread = new Map()   // contextThreadId -> token  (message in the thread = edit)

function rememberDraft(entry) {
  const id = Math.random().toString(36).slice(2, 10)
  drafts.set(id, entry)
  if (drafts.size > 100) { const k = drafts.keys().next().value; const old = drafts.get(k); if (old?.cardMessageId) draftByMessage.delete(old.cardMessageId); drafts.delete(k) }
  return id
}

const fmtList = (a) => (a && a.length ? a.join(', ') : '—')

function buildDraftEmbed(d) {
  return new EmbedBuilder()
    .setTitle('✉️ Draft — review before sending')
    .setDescription((d.body || '(empty)').slice(0, 4000))
    .addFields(
      field('Subject', d.subject || '(none)'),
      field('To', fmtList(d.to), true),
      field('CC', fmtList(d.cc), true),
      field('BCC', fmtList(d.bcc), true),
    )
    .setFooter({ text: 'Saved as a Gmail draft — nothing is sent until you click Send. Reply to this message to revise the body.' })
}
function draftButtons(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dr_recip:${id}`).setLabel('✏️ Recipients').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`dr_msg:${id}`).setLabel('📝 Message').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`dr_send:${id}`).setLabel('📤 Send').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`dr_discard:${id}`).setLabel('🗑️ Discard').setStyle(ButtonStyle.Danger),
  )
}
const parseAddrs = (s) => (s || '').split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean)

// Push the current draft state to the Gmail draft (re-threads if it's a reply).
async function syncDraftToGmail(d) {
  const r = await emailDraftCreate({
    draftId: d.draftId, replyToGmailId: d.replyToEmailId || undefined,
    to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, body: d.body,
  })
  d.draftId = r.draftId
  return r
}
async function refreshCard(interactionOrMsg, d, id) {
  const payload = { embeds: [buildDraftEmbed(d)], components: [draftButtons(id)] }
  try {
    const ch = await client.channels.fetch(d.channelId)
    const msg = await ch.messages.fetch(d.cardMessageId)
    await msg.edit(payload)
  } catch { /* card gone */ }
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

    } else if (interaction.isModalSubmit() && interaction.customId.startsWith('drm_')) {
      const [kind, id] = interaction.customId.split(':')
      const d = drafts.get(id)
      if (!d) { await interaction.reply({ content: 'This draft has expired.', flags: MessageFlags.Ephemeral }); return }
      await interaction.deferUpdate()
      if (kind === 'drm_recip') {
        d.to = parseAddrs(interaction.fields.getTextInputValue('to'))
        d.cc = parseAddrs(interaction.fields.getTextInputValue('cc'))
        d.bcc = parseAddrs(interaction.fields.getTextInputValue('bcc'))
      } else if (kind === 'drm_msg') {
        d.subject = interaction.fields.getTextInputValue('subject').trim()
        d.body = interaction.fields.getTextInputValue('body')
      }
      await syncDraftToGmail(d)
      await refreshCard(interaction, d, id)

    } else if (interaction.isButton() && interaction.customId.startsWith('dr_')) {
      const [action, id] = interaction.customId.split(':')
      const d = drafts.get(id)
      if (!d) { await interaction.reply({ content: 'This draft has expired.', flags: MessageFlags.Ephemeral }); return }
      if (OWNER_ID && interaction.user.id !== OWNER_ID && interaction.user.id !== d.userId) {
        await interaction.reply({ content: 'Only the requester can act on this draft.', flags: MessageFlags.Ephemeral }); return
      }
      if (action === 'dr_recip') {
        const m = new ModalBuilder().setCustomId(`drm_recip:${id}`).setTitle('Edit recipients')
        const f = (cid, label, val) => new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId(cid).setLabel(label).setStyle(TextInputStyle.Short).setRequired(false).setValue((val || []).join(', ')))
        m.addComponents(f('to', 'To (comma-separated)', d.to), f('cc', 'CC', d.cc), f('bcc', 'BCC', d.bcc))
        await interaction.showModal(m)
      } else if (action === 'dr_msg') {
        const m = new ModalBuilder().setCustomId(`drm_msg:${id}`).setTitle('Edit message')
        m.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('subject').setLabel('Subject').setStyle(TextInputStyle.Short).setRequired(false).setValue(d.subject || '')),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('body').setLabel('Body').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue((d.body || '').slice(0, 4000))))
        await interaction.showModal(m)
      } else if (action === 'dr_send') {
        if (!d.to.length) { await interaction.reply({ content: '⚠️ No "To" recipient set — add one with ✏️ Recipients first.', flags: MessageFlags.Ephemeral }); return }
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`dr_sendok:${id}`).setLabel('Confirm send').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`dr_cancel:${id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary))
        await interaction.reply({ content: `Send to **${fmtList(d.to)}**${d.cc.length ? ` · CC ${fmtList(d.cc)}` : ''}${d.bcc.length ? ` · BCC ${fmtList(d.bcc)}` : ''}?`, components: [row], flags: MessageFlags.Ephemeral })
      } else if (action === 'dr_cancel') {
        await interaction.update({ content: 'Send cancelled.', components: [] })
      } else if (action === 'dr_sendok') {
        await interaction.update({ content: '📤 Sending…', components: [] })
        await emailDraftSend({ draftId: d.draftId, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject })
        try {
          const ch = await client.channels.fetch(d.channelId); const msg = await ch.messages.fetch(d.cardMessageId)
          await msg.edit({ embeds: [buildDraftEmbed(d).setTitle('✅ Sent').setFooter({ text: `Sent to ${fmtList(d.to)}` })], components: [] })
        } catch { /* card gone */ }
        await interaction.editReply({ content: `✅ Sent to ${fmtList(d.to)}.`, components: [] })
        draftByMessage.delete(d.cardMessageId); drafts.delete(id)
      } else if (action === 'dr_discard') {
        try { await emailDraftDiscard(d.draftId) } catch { /* already gone */ }
        try { const ch = await client.channels.fetch(d.channelId); const msg = await ch.messages.fetch(d.cardMessageId); await msg.edit({ embeds: [buildDraftEmbed(d).setTitle('🗑️ Discarded')], components: [] }) } catch { /* */ }
        draftByMessage.delete(d.cardMessageId); drafts.delete(id)
        await interaction.reply({ content: '🗑️ Draft discarded.', flags: MessageFlags.Ephemeral })
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
    const text = (message.content ?? '').replace(/<@!?\d+>/g, '').trim()

    // Talk-to-edit (works anywhere, incl. the context thread): a reply to a draft card OR a
    // message inside the draft's context thread revises that draft's body.
    const editTok = (message.reference?.messageId && draftByMessage.get(message.reference.messageId)) || draftByThread.get(message.channelId)
    if (editTok && text) {
      const d = drafts.get(editTok)
      if (d) {
        await message.channel.sendTyping().catch(() => {})
        d.body = await reviseDraft({ subject: d.subject, body: d.body, instruction: text })
        await syncDraftToGmail(d)
        await refreshCard(message, d, editTok)
        await message.reply('✏️ Updated the draft.').catch(() => {})
        return
      }
    }

    const isDM = !message.guildId
    if (!isDM && CHAT_CHANNELS.length) {
      const chName = message.channel?.name
      const allowed = CHAT_CHANNELS.includes(message.channelId) || (chName && CHAT_CHANNELS.includes(chName))
      if (!allowed) return
    }

    // Attachments → images via vision, PDFs read natively.
    const atts = [...message.attachments.values()]
    const images = atts.filter((a) => (a.contentType || '').startsWith('image/')).map((a) => a.url)
    const docs = atts.filter((a) => (a.contentType || '') === 'application/pdf').map((a) => a.url)
    if (!text && !images.length && !docs.length) return
    await message.channel.sendTyping().catch(() => {})
    const fallback = docs.length ? 'Read and summarize the attached document.' : 'Describe / analyze the attached image.'
    const { text: answer, model, costUSD, searches, draftCard } = await chat(message.channelId, text || fallback, images, docs)
    const searchTag = searches ? ` · 🔎 ${searches}` : ''
    const footer = `\n-# 🪙 ${model.replace('claude-', '')} · ~$${costUSD.toFixed(4)}${searchTag}`
    const chunks = answer.match(/[\s\S]{1,1900}/g) ?? ['(no response)']
    chunks[chunks.length - 1] += footer
    await message.reply(chunks[0])
    for (const c of chunks.slice(1)) await message.channel.send(c)

    // If a tool created a draft, post the interactive review card.
    if (draftCard) {
      const d = { ...draftCard, channelId: message.channelId, userId: message.author.id, cardMessageId: null }
      const id = rememberDraft(d)
      const card = await message.channel.send({ embeds: [buildDraftEmbed(d)], components: [draftButtons(id)] })
      d.cardMessageId = card.id
      draftByMessage.set(card.id, id)
      // Stage B: for a reply, attach a context thread (previous email + thread summary) so the
      // card itself stays clean.
      if (d.replyToEmailId) {
        try {
          const thread = await card.startThread({ name: `Context: ${(d.subject || 'email').replace(/^re:\s*/i, '').slice(0, 80)}` })
          draftByThread.set(thread.id, id) // messages in this thread = talk-to-edit
          const emails = await getEmailThread(d.replyToEmailId)
          const prev = emails.find((e) => e.id === d.replyToEmailId) || emails[emails.length - 1]
          if (prev) {
            await thread.send(`📧 **Previous email** — from ${prev.from_addr || 'unknown'}\n**${prev.subject || '(no subject)'}**\n\n${(prev.body || '(no body stored)').slice(0, 1800)}`)
          }
          const summary = await summarizeThread(emails)
          if (summary) await thread.send(`🧵 **Thread summary**\n${summary}`.slice(0, 1900))
        } catch (e) {
          console.error('draft context thread failed:', e.message)
        }
      }
    }
  } catch (e) {
    console.error('message error:', e)
    try { await message.reply(`⚠️ ${e.message}`) } catch { /* interaction gone */ }
  }
})

client.login(TOKEN)
