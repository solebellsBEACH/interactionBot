/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const apiPort = process.env.API_PORT || '5050'
    return [
      {
        source: '/api/:path*',
        destination: `http://localhost:${apiPort}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
