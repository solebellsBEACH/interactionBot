export type GptConfig = {
  enabled: boolean
  apiKey?: string
  model: string
  baseUrl?: string
  requestTimeoutMs: number
  temperature: number
  maxTokens: number
}
