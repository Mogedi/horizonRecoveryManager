// General-purpose visual verification via Claude Vision.
//
// Pattern: screenshot (base64 PNG) + VisualCheckSpec → VisualCheckResult
// Layer 3 verifiers (hubspot-browser/drive-check.ts, skip-tracing/browser-lookup.ts)
// call this with use-case-specific specs. This module stays generic.

import { callClaudeWithImages } from './client'
import { AIError } from './errors'
import { log } from '@/lib/logger'

export type VisualCheckSpec = {
  description: string
  // Items that should be visually present in the screenshot
  expectedItems?: string[]
  // Values to extract from the screenshot (e.g. "phone numbers", "file names")
  extractFields?: string[]
}

export type VisualCheckResult = {
  passed: boolean
  confidence: 'high' | 'medium' | 'low'
  findings: string[]                        // plain-English observations
  missingItems: string[]                    // expectedItems that were not found
  extracted: Record<string, string>         // extractFields results (empty if none requested)
  raw: string                               // raw Claude response, for debugging
}

const SYSTEM_PROMPT =
  'You are a visual verification assistant. Analyze screenshots and answer questions about ' +
  'what is visible. Always respond with valid JSON only — no markdown, no preamble.'

export async function verifyScreenshot(
  screenshotBase64: string,
  spec: VisualCheckSpec,
  mimeType: 'image/png' | 'image/jpeg' = 'image/jpeg',
): Promise<VisualCheckResult> {
  const expectedSection = spec.expectedItems?.length
    ? `\n\nCheck whether each of these items is clearly visible:\n${spec.expectedItems.map((item, i) => `${i + 1}. "${item}"`).join('\n')}`
    : ''

  const extractSection = spec.extractFields?.length
    ? `\n\nExtract the following from the screenshot:\n${spec.extractFields.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
    : ''

  const loginDetect =
    '\n\nIf the page shows a login screen or authentication wall instead of the expected content, ' +
    'set passed=false and include "session_expired" in findings.'

  const prompt =
    `Task: ${spec.description}${expectedSection}${extractSection}${loginDetect}

Respond with JSON in this exact shape:
{
  "passed": true | false,
  "confidence": "high" | "medium" | "low",
  "findings": ["observation 1", "observation 2"],
  "missingItems": ["item not found 1"],
  "extracted": { "field name": "extracted value" }
}

Rules:
- passed=true only if ALL expectedItems are found (or no expectedItems specified and content looks correct)
- confidence reflects how clearly you can read the content (high=crisp text, low=blurry/small)
- findings lists what you observed, including confirmations AND absences
- missingItems lists only items from the expectedItems list that were NOT found
- extracted is empty {} if no extractFields were requested`

  let raw = ''

  try {
    raw = await callClaudeWithImages(
      prompt,
      [{ data: screenshotBase64, mimeType }],
      SYSTEM_PROMPT,
      1024,
    )

    // Claude sometimes wraps JSON in markdown code fences despite instructions.
    // Strip them before parsing.
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/m, '').trim()
    const parsed = JSON.parse(jsonStr) as Partial<VisualCheckResult>

    return {
      passed: Boolean(parsed.passed),
      confidence: (['high', 'medium', 'low'] as const).includes(parsed.confidence as never)
        ? parsed.confidence as 'high' | 'medium' | 'low'
        : 'low',
      findings: Array.isArray(parsed.findings) ? parsed.findings as string[] : [],
      missingItems: Array.isArray(parsed.missingItems) ? parsed.missingItems as string[] : [],
      extracted: (parsed.extracted && typeof parsed.extracted === 'object')
        ? parsed.extracted as Record<string, string>
        : {},
      raw,
    }
  } catch (err) {
    if (err instanceof AIError) throw err

    log.warn('vision-verify: failed to parse Claude response', { raw, err })

    return {
      passed: false,
      confidence: 'low',
      findings: ['Verification failed — could not parse AI response'],
      missingItems: spec.expectedItems ?? [],
      extracted: {},
      raw,
    }
  }
}
