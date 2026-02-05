import { NextResponse } from 'next/server'
import { getJob } from '../store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'missing-id' }, { status: 400 })
  }

  const job = getJob(id)
  if (!job) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 })
  }

  return NextResponse.json({ job })
}
