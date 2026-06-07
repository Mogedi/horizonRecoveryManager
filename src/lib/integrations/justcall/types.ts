// JustCall API v2.1 response shapes.
// Field names match the JustCall API exactly — do not rename here.
// All downstream code uses NormalizedCallLog from phone-provider.ts.

export interface JustCallCallInfo {
  direction: string    // "Outgoing" | "Incoming"
  type: string         // "Answered" | "Missed" | "Unanswered" | "Voicemail" | "Busy" | etc.
  status: string       // "Archived" | "Unarchived"
  disposition: string | null
  notes: string | null
  recording: string | null
}

export interface JustCallCallDuration {
  friendly_duration: string  // "hh:mm:ss"
  total_duration: number     // seconds
  conversation_time: number  // seconds, excluding hold
}

export interface JustCallCall {
  id: number
  call_sid: string
  contact_number: string    // customer's phone number
  contact_name: string | null
  contact_email: string | null
  justcall_number: string   // JustCall business line number
  justcall_line_name: string | null
  call_date: string         // UTC timestamp string
  call_user_date: string | null
  call_user_time: string | null
  agent_id: number
  agent_name: string | null
  agent_email: string | null
  agent_active: string | null
  call_info: JustCallCallInfo
  call_duration: JustCallCallDuration
  cost_incurred: number | null
}

export interface JustCallCallsResponse {
  status: string
  count: number    // items in this page
  total: number    // total across all pages
  data: JustCallCall[]
}
