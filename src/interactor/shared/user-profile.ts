import fs from "fs";
import path from "path";

export type UserProfile = {
    summary: string
    answers: Record<string, string>
}

const defaultProfile: UserProfile = {
    summary: "",
    answers: {}
}

const loadProfileFromFile = () => {
    const profilePath = path.resolve(process.cwd(), "data", "user-profile.json")
    if (!fs.existsSync(profilePath)) return null

    try {
        const raw = fs.readFileSync(profilePath, "utf-8")
        const data = JSON.parse(raw)
        return {
            summary: typeof data.summary === "string" ? data.summary : "",
            answers: typeof data.answers === "object" && data.answers ? data.answers : {}
        } as UserProfile
    } catch {
        return null
    }
}

const fileProfile = loadProfileFromFile()
const envSummary = process.env.USER_PROFILE?.trim() || ""

export const userProfile: UserProfile = {
    summary: fileProfile?.summary || envSummary || defaultProfile.summary,
    answers: fileProfile?.answers || defaultProfile.answers
}
