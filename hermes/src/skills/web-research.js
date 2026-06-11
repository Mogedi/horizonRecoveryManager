// Skill: web-research — search the web for outside information using Anthropic's server-side
// web_search tool (executed on Anthropic's infra; no extra API key). The chat loop adds these
// serverTools to the request when the skill is active and handles pause_turn continuations.
import { webExtract } from '../web-fetch.js'

export default {
  name: 'web-research',
  description: 'Search the web and read specific pages: where a county holds surplus/tax-sale funds, treasurer/clerk-of-court offices, claim procedures and deadlines, phone numbers, addresses, etc.',
  playbook:
    'Use web_search to find information not in our database. Use web_extract to read a SPECIFIC page in ' +
    'full (a URL Mo gives you, or a promising result from web_search) — it returns the readable text. ' +
    'Prefer official county/court/state .gov sources; cite the source URLs and note when something should ' +
    'be confirmed by calling the office. Be specific and current.',
  writes: false,
  defaultEnabled: true,
  tools: [
    {
      name: 'web_extract',
      description: 'Fetch a specific public web page and return its readable text (for reading a page in detail). Public http(s) URLs only.',
      input_schema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'the page URL to read' } },
        required: ['url'],
      },
    },
  ],
  handlers: {
    web_extract: async (input) => {
      if (!input.url) return 'a url is required'
      try {
        return await webExtract(String(input.url))
      } catch (e) {
        return `could not read that page: ${e.message}`
      }
    },
  },
  // Anthropic server tool — no local handler; the API executes it. ~$0.01 per search.
  serverTools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
}
