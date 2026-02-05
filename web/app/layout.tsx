import type { Metadata } from 'next'
import { Manrope, Space_Grotesk } from 'next/font/google'
import './globals.css'

const displayFont = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600', '700']
})

const bodyFont = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700']
})

export const metadata: Metadata = {
  title: 'Interaction Bot',
  description: 'Painel para acionar o bot do LinkedIn com controle humano.'
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>
        <main>{children}</main>
      </body>
    </html>
  )
}
