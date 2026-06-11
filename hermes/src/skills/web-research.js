// Skill: web-research — search the web for outside information using Anthropic's server-side
// web_search tool (executed on Anthropic's infra; no extra API key). The chat loop adds these
// serverTools to the request when the skill is active and handles pause_turn continuations.
export default {
  name: 'web-research',
  description: 'Search the web for outside info: where a county holds surplus/tax-sale funds, treasurer/clerk-of-court offices, claim procedures and deadlines, phone numbers, addresses, etc.',
  playbook:
    'Use web_search for questions that need information not in our database — e.g. "where are surplus ' +
    'funds held for DeKalb County, GA", county treasurer/clerk contacts, claim forms/deadlines. ' +
    'Prefer official county/court/state .gov sources; cite the source URLs in your answer and note ' +
    'when something should be confirmed by calling the office. Be specific and current.',
  writes: false,
  defaultEnabled: true,
  tools: [],
  handlers: {},
  // Anthropic server tool — no local handler; the API executes it. ~$0.01 per search.
  serverTools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
}
