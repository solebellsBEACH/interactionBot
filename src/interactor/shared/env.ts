import fs from "fs";
import path from "path";

const loadEnvFromFile = (filePath: string) => {
  if (!fs.existsSync(filePath)) return

  const content = fs.readFileSync(filePath, "utf-8")
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const idx = trimmed.indexOf("=")
    if (idx === -1) continue

    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()
    if (!key) continue

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

loadEnvFromFile(path.resolve(process.cwd(), ".env"))

export const env = {
  userDataDir: '/home/lucas/.config/google-chrome/Default',
  linkedinAuth: {
    email: process.env.LINKEDIN_EMAIL?.trim(),
    password: process.env.LINKEDIN_PASSWORD,
  },
  discord: {
    enabled: process.env.DISCORD_ENABLED?.toLowerCase() === 'true' || Boolean(process.env.DISCORD_WEBHOOK_URL),
    webhookUrl: process.env.DISCORD_WEBHOOK_URL?.trim(),
    requestTimeoutMs: Number(process.env.DISCORD_TIMEOUT_MS || 120_000),
    interactive: process.env.DISCORD_INTERACTIVE?.toLowerCase() === 'true',
    consoleOnly: process.env.DISCORD_CONSOLE_ONLY?.toLowerCase() === 'true',
  },
  linkedinURLs: {
    postUrl: 'https://www.linkedin.com/search/results/content/?keywords=%23react%20%23job&origin=GLOBAL_SEARCH_HEADER&sid=-mV',
    feedURL: 'https://www.linkedin.com/feed/',
    searchJobTag: 'React',
    jobURL: `https://www.linkedin.com/jobs/view/4329650329/?alternateChannel=search&eBP=CwEAAAGbrWB8U9iXHSkKncLYIm4rUbKGEjWIlKTFrLfTfECq1Rc2ttK9qjYBsNaiqC-cEAMZWDowGsnsWr69Xn11ZTO3EYQeyMPbXaNfq8Fgj6D9mWyg9E9MKeRaxHMq7WAr3M3owmMKe-PFNGilprGfx4z76hG0RLPPdWyxbnGuWXmMg9l9aHs4by-ly60nMmwW2zLkZTmDekpIXHr1e7zHkKCVt9F5GDMHe7mxQqPbLic_9Zzi7xFYTRVx-GGzv1rPQpmin9U5B5drUKHvRtpQU2ZxjNfRRmnaWUUsrKBZwxVg861O_FbwLHdYh7TGoI0Ff0YUu3fo2NH4N1ADVW1z4ZT3XUz5Hb-6pMKEJPLcdtSIUNnYZjr_IHJ8Op7Az90Mn1s0v6k0dZ9zaXv6apDGJ2s9ItFgnNhkLQoyaM3m7MqUjMs4yNf5E-iCDHMDUha-zPA5yeb2QiILyfy37K1Yc4ijBgtcM-ZXBtVVeV1a0BrkK5vo2vGwnhfwCZxcsIh2gTqmmL0uselOR4LZbMNtrQQOjA&refId=BVOw3msTNY%2FulrpYf2WasA%3D%3D&trackingId=elPrpgYn0fPpCwzATKoleQ%3D%3D&trk=d_flagship3_search_srp_jobs`,
    recruiterURL: "https://www.linkedin.com/in/philipe-loureiro/",
    message: 'Convidar Philipe Loureiro para se conectar'
  }
}
